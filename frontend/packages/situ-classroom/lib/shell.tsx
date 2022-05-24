import Convert from "ansi-to-html";
import _ from "lodash";
import { action } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import React, { useContext, useEffect, useRef } from "react";
import ReactTestUtils from "react-dom/test-utils";

import { ClientContext, ClientMessage, ShellOutput } from "./client";
import { Action, RecorderContext, ReplayContext } from "./recorder";

interface ShellAction extends Action {
  type: "ShellAction";
  key: string;
  value: string;
}

export let Shell = observer(() => {
  let client = useContext(ClientContext)!;
  let recorder = useContext(RecorderContext);
  let replayer = useContext(ReplayContext);
  let containerRef = useRef<HTMLDivElement>(null);
  let inputRef = useRef<HTMLInputElement>(null);
  let state = useLocalObservable<{ lines: string[]; history: string[]; historyIndex: number }>(
    () => ({
      lines: [],
      history: [],
      historyIndex: 0,
    })
  );

  useEffect(() => {
    let converter = new Convert();
    client.addListener(
      "ShellOutput",
      action(({ output }: ShellOutput) => {
        output.split("\n").forEach(line => {
          state.lines.push(converter.toHtml(line));
        });
      })
    );
  }, []);

  useEffect(() => {
    let el = containerRef.current!;
    // TODO: this is anti-modular
    (el.parentNode! as HTMLDivElement).scrollTo(0, el.clientHeight);
  }, [state.lines.length]);

  let onKeyUp: React.KeyboardEventHandler<HTMLInputElement> = action(e => {
    let el = e.target as HTMLInputElement;
    let command = el.value;

    if (recorder) {
      let action: ShellAction = {
        type: "ShellAction",
        key: e.key,
        value: el.value,
      };
      recorder.addAction(action);
    }

    if (e.key == "Enter") {
      state.history.push(command);
      state.historyIndex = state.history.length;

      if (command == "clear") {
        state.lines = [];
      } else {
        let msg: ClientMessage;
        if (command.startsWith("edit ")) {
          msg = {
            type: "OpenFile",
            path: command.slice(5),
          };
        } else {
          msg = {
            type: "ShellExec",
            command,
          };
        }

        client.send(msg);
        state.lines.push("$ " + command);
      }

      el.value = "";
    } else if (e.key == "ArrowUp" || e.key == "ArrowDown") {
      e.preventDefault();
      if (state.history.length > 0) {
        state.historyIndex += e.key == "ArrowUp" ? -1 : 1;
        state.historyIndex = Math.max(0, Math.min(state.historyIndex, state.history.length - 1));
        el.value = state.history[state.historyIndex];
      }
    }
  });

  useEffect(() => {
    if (replayer) {
      replayer.addListener("ShellAction", (action: ShellAction) => {
        let input = inputRef.current!;
        input.value = action.value;
        ReactTestUtils.Simulate.keyUp(input, { key: action.key });
      });
    }
  }, []);

  return (
    <div className="shell" ref={containerRef}>
      {state.lines.map((line, i) => (
        <div key={i} dangerouslySetInnerHTML={{ __html: line }} />
      ))}
      $ <input type="text" onKeyUp={onKeyUp} ref={inputRef}></input>
    </div>
  );
});
