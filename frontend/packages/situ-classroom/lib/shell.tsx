import { action } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import React, { useContext, useEffect, useRef } from "react";

import { ClientContext, ClientMessage, ShellOutput } from "./client";

export let Shell = observer(() => {
  let client = useContext(ClientContext)!;
  let ref = useRef<HTMLDivElement>(null);
  let state = useLocalObservable<{ lines: string[] }>(() => ({
    lines: [],
  }));

  useEffect(() => {
    client.addListener(
      "ShellOutput",
      action(({ output }: ShellOutput) => {
        state.lines.push(output);
      })
    );
  }, []);

  useEffect(() => {
    let el = ref.current!;
    // TODO: this is anti-modular
    (el.parentNode! as HTMLDivElement).scrollTo(0, el.clientHeight);
  }, [state.lines.length]);

  let onKeyUp: React.KeyboardEventHandler<HTMLInputElement> = action(e => {
    if (e.key == "Enter") {
      let el = e.target as HTMLInputElement;
      let command = el.value;

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
      el.value = "";
    }
  });

  return (
    <div className="shell" ref={ref}>
      {state.lines.map((line, i) => (
        <pre key={i}>{line}</pre>
      ))}
      $ <input type="text" onKeyUp={onKeyUp}></input>
    </div>
  );
});
