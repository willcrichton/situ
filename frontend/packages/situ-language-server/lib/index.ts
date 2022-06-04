import { execSync } from "child_process";
import { dirname } from "path";
import * as rpc from "vscode-ws-jsonrpc";
import * as rpcServer from "vscode-ws-jsonrpc/lib/server/index.js";
import ws, { WebSocketServer } from "ws";

const SERVER_PORT = 8081;

const wss = new WebSocketServer(
  {
    port: SERVER_PORT,
    perMessageDeflate: false,
  },
  () => {
    console.log(`Listening to http and ws requests on ${SERVER_PORT}`);
  }
);

function toSocket(webSocket: ws): rpc.IWebSocket {
  return {
    send: content => webSocket.send(content),
    onMessage: cb => (webSocket.onmessage = event => cb(event.data)),
    onError: cb =>
      (webSocket.onerror = event => {
        if ("message" in event) {
          cb(event.message);
        }
      }),
    onClose: cb => (webSocket.onclose = event => cb(event.code, event.reason)),
    dispose: () => webSocket.close(),
  };
}

wss.on("connection", (client, request) => {
  const reqUrl = new URL(request.url!, `http://${request.headers.host}`);
  const currFile = reqUrl.searchParams.get("absPath")!;
  const currFileDir = dirname(currFile);

  const result = execSync("cargo locate-project", { cwd: currFileDir }).toString();
  const cwd = dirname(JSON.parse(result).root);

  const localConnection = rpcServer.createServerProcess("rust-analyzer", "/bin/rust-analyzer", [], {
    cwd,
  });
  const socket = toSocket(client);
  const connection = rpcServer.createWebSocketConnection(socket);
  rpcServer.forward(connection, localConnection);
  socket.onClose(() => {
    localConnection.dispose();
  });
});
