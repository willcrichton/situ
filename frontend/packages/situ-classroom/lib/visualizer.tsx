import React, { useContext, useEffect, useState } from "react";

import { ClientMessage } from "./bindings/ClientMessage";
import { MVOutput } from "./bindings/MVOutput";
import { MVValue } from "./bindings/MVValue";
import { ClientContext } from "./client";

let Value: React.FC<{ value: MVValue }> = ({ value }) => {
  if (value.type == "Bool" || value.type == "Uint" || value.type == "Int") {
    return <code>{value.value.toString()}</code>;
  } else if (value.type == "Char") {
    return <code>'{value.value}'</code>;
  } else if (value.type == "Float") {
    return <code>{value.value.toPrecision(3)}</code>;
  } else if (value.type == "String") {
    return <code>"{value.value}"</code>;
  } else if (value.type == "Struct") {
    let { name, fields } = value.value;
    return (
      <span>
        <code>{name}(</code>
        {fields.map(([key, value], i) => (
          <>
            {key}: <Value key={i} value={value} />,
          </>
        ))}
        <code>)</code>
      </span>
    );
  } else {
    return <>Unknown: {value.type}</>;
  }
};

export let Visualizer = () => {
  let client = useContext(ClientContext)!;
  let [state, setState] = useState<MVOutput | null>(null);

  let onClick = () => {
    let message: ClientMessage = { type: "RunVis" };
    client.send(message);
  };

  useEffect(() => {
    client.addListener("VisOutput", message => {
      setState(message.output);
    });
  }, []);

  return (
    <div>
      <button onClick={onClick}>Visualize</button>
      {state ? (
        <div>
          {state.map((frame, i) => (
            <div key={i}>
              {frame.name}:
              {Object.keys(frame.locals).map((local, j) => (
                <div key={j}>
                  <>
                    {local}: <Value value={frame.locals[local]} />
                  </>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
