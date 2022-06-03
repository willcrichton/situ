import { makeAutoObservable } from "mobx";
import { observer } from "mobx-react";
import React, { useContext, useEffect } from "react";

import { ClientMessage } from "./bindings/ClientMessage";
import { MFrame } from "./bindings/MFrame";
import { MOutput } from "./bindings/MOutput";
import { MValue } from "./bindings/MValue";
import { ClientContext } from "./client";

let decode_string = (value: MValue & { type: "Struct" }): string => {
  let vec = value.value.fields[0][1] as MValue & { type: "Vec" };
  let buffer = new Uint8Array(vec.value.length);
  vec.value.forEach((v, i) => {
    let n = v as MValue & { type: "Uint" };
    console.log(n.value);
    buffer[i] = n.value as any;
  });
  let decoder = new TextDecoder();
  let contents = decoder.decode(buffer);
  return contents;
};

let Value: React.FC<{ value: MValue }> = ({ value }) => {
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
    if (name == "String") {
      let contents = decode_string(value);
      return <code>"{contents}"</code>;
    } else {
      return (
        <>
          <code>{name}(</code>
          {fields.map(([key, value], i) => (
            <>
              <code>{key}</code>: <Value key={i} value={value} />,{" "}
            </>
          ))}
          <code>)</code>
        </>
      );
    }
  } else if (value.type == "Vec") {
    return (
      <>
        [
        {value.value.map((value, i) => (
          <>
            <Value key={i} value={value} />,{" "}
          </>
        ))}
        ]
      </>
    );
  } else if (value.type == "Unallocated") {
    return <>💀</>;
  } else {
    throw `Unreachable`;
  }
};

let Frame: React.FC<{ frame: MFrame }> = ({ frame }) => {
  return (
    <div className="frame">
      {/* <code>{frame.name}</code>: */}
      <table className="locals">
        <thead>
          <th>Name</th>
          <th>Value</th>
        </thead>
        {frame.locals.map(([local, value], i) => (
          <tr key={i}>
            <td>
              <code>{local}</code>
            </td>
            <td>
              <Value value={value} />
            </td>
          </tr>
        ))}
      </table>
    </div>
  );
};

export class VisualizerState {
  step: number = -1;
  output: MOutput | null = null;

  constructor() {
    makeAutoObservable(this);
  }
}

export let VisualizerContext = React.createContext<VisualizerState | null>(null);

export let Visualizer = observer(() => {
  let client = useContext(ClientContext)!;
  let visualizer = useContext(VisualizerContext)!;

  let onClick = () => {
    let message: ClientMessage = { type: "RunVis" };
    client.send(message);
  };

  useEffect(() => {
    client.addListener("VisOutput", message => {
      console.log(message.output);
      visualizer.output = message.output;
      visualizer.step = 0;
    });
  }, []);

  return (
    <div className="visualizer">
      <button onClick={onClick}>Visualize</button>
      {visualizer.output ? (
        <div>
          <button
            onClick={() => {
              visualizer.step = Math.max(visualizer.step - 1, 0);
            }}
          >
            ←
          </button>
          <input
            type="range"
            value={visualizer.step}
            min="0"
            max={visualizer.output.length - 1}
            onChange={e => {
              visualizer.step = parseInt(e.target.value);
            }}
          />
          <button
            onClick={() => {
              visualizer.step = Math.min(visualizer.step + 1, visualizer.output!.length - 1);
            }}
          >
            →
          </button>
          <Frame frame={visualizer.output[visualizer.step]} />
        </div>
      ) : null}
    </div>
  );
});
