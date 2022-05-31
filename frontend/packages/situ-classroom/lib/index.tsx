import React, { useState } from "react";
import * as ReactDOM from "react-dom/client";
import Split from "react-split";

import "../static/index.html";
import "../static/index.scss";
import { Client, ClientContext } from "./client";
import { Editor } from "./editor";
import { RecordContext, RecordState, Recorder, ReplayContext, ReplayState } from "./recorder";
import { Shell } from "./shell";
import { Transcript } from "./transcript";
import { Visualizer } from "./visualizer";

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
            <Split className="split horizontal" direction="horizontal">
              <Split className="split vertical" direction="vertical">
                <Editor />
                <Visualizer />
                <Shell />
              </Split>
              <Transcript />
            </Split>
          </div>
        </ReplayContext.Provider>
      </RecordContext.Provider>
    </ClientContext.Provider>
  );
};

let root = ReactDOM.createRoot(document.getElementById("app")!);
root.render(<App />);
