import React, { PropsWithChildren, useState } from "react";
import * as ReactDOM from "react-dom/client";

import "../static/index.html";
import "../static/index.scss";
import { Client, ClientContext } from "./client";
import { Editor } from "./editor";
import { RecordContext, RecordState, Recorder, ReplayContext, ReplayState } from "./recorder";
import { Shell } from "./shell";
import { Visualizer } from "./visualizer";

let Panel: React.FC<PropsWithChildren<{}>> = ({ children }) => (
  <div className="panel">{children}</div>
);

let App: React.FC = () => {
  let [client] = useState(() => new Client());
  let [recorder] = useState(() => new RecordState());
  let [replayer] = useState(() => new ReplayState(recorder));
  return (
    <ClientContext.Provider value={client}>
      <RecordContext.Provider value={recorder}>
        <ReplayContext.Provider value={replayer}>
          <Recorder />
          <div className="container">
            <Panel>
            <Visualizer />
              <Editor />
            </Panel>
            <Panel>
              <Shell />
            </Panel>
          </div>
        </ReplayContext.Provider>
      </RecordContext.Provider>
    </ClientContext.Provider>
  );
};

let root = ReactDOM.createRoot(document.getElementById("app")!);
root.render(<App />);
