import React, { useContext, useEffect } from "react";
import { observer, useLocalObservable } from "mobx-react";

import { ClientContext, ShellExec, ShellOutput } from "./client";
import { action } from "mobx";

export let Shell = observer(() => {
  let client = useContext(ClientContext)!;
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

  return (
    <div className="shell">
      {state.lines.map((line, i) => (
        <pre key={i}>{line}</pre>
      ))}
      ${" "}
      <input
        type="text"
        onKeyUp={action(e => {
          if (e.key == "Enter") {
            let el = e.target as HTMLInputElement;
            let msg: ShellExec = {
              type: "ShellExec",
              command: el.value,
            };
            client.send(msg);
            state.lines.push("$ " + el.value);
            el.value = "";
          }
        })}
      ></input>
    </div>
  );
});
