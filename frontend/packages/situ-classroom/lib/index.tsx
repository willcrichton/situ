import React, { PropsWithChildren, useState } from "react";
import * as ReactDOM from "react-dom/client";

import "../static/index.html";
import "../static/index.scss";
import { Client, ClientContext } from "./client";
import { Editor } from "./editor";
import { Actions, Recorder, RecorderContext, ReplayContext, Replayer } from "./recorder";
import { Shell } from "./shell";

let Panel: React.FC<PropsWithChildren<{}>> = ({ children }) => (
  <div className="panel">{children}</div>
);

let App: React.FC = () => {
  let [client] = useState(() => new Client());
  let [recorder] = useState(() => new Actions());
  let [replayer] = useState(() => new Replayer(recorder));
  return (
    <ClientContext.Provider value={client}>
      <RecorderContext.Provider value={recorder}>
        <ReplayContext.Provider value={replayer}>
          <Recorder />
          <div className="container">
            <Panel>
              <Editor />
            </Panel>
            <Panel>
              <Shell />
            </Panel>
          </div>
        </ReplayContext.Provider>
      </RecorderContext.Provider>
    </ClientContext.Provider>
  );
};

let root = ReactDOM.createRoot(document.getElementById("app")!);
root.render(<App />);
