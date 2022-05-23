import React, { PropsWithChildren, useState } from "react";
import * as ReactDOM from "react-dom/client";

import "../static/index.html";
import "../static/index.scss";
import { Client, ClientContext } from "./client";
import { Editor } from "./editor";
import { Shell } from "./shell";

let Panel: React.FC<PropsWithChildren<{}>> = ({ children }) => (
  <div className="panel">{children}</div>
);

let App: React.FC = () => {
  let [client] = useState(() => new Client());
  return (
    <ClientContext.Provider value={client}>
      <div className="container">
        <Panel>
          <Editor />
        </Panel>
        <Panel>
          <Shell />
        </Panel>
      </div>
    </ClientContext.Provider>
  );
};

let root = ReactDOM.createRoot(document.getElementById("app")!);
root.render(<App />);
