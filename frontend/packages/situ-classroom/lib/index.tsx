import React, { useState } from "react";
import * as ReactDOM from "react-dom/client";

import { Client, ClientContext } from "./client";
import { Shell } from "./shell";

import "../static/index.html";
import "../static/index.scss";

let App: React.FC = () => {
  let [client] = useState(() => new Client());
  return (
    <ClientContext.Provider value={client}>
      <Shell />
    </ClientContext.Provider>
  );
};

let root = ReactDOM.createRoot(document.getElementById("app")!);
root.render(<App />);
