import React from "react";

export interface ShellExec {
  type: "ShellExec";
  command: string;
}

export interface ShellOutput {
  type: "ShellOutput";
  output: string;
}

export type ClientMessage = ShellExec;
export type ServerMessage = ShellOutput;

export type Listener = (message: any) => void;

export class Client {
  ready: boolean = false;
  listeners: { [type: string]: Listener[] } = {};
  ws: WebSocket;

  constructor() {
    this.ws = new WebSocket(`ws://${location.hostname}:8080`);
    this.ws.onopen = () => {
      this.ready = true;
    };
    this.ws.onmessage = data => {
      let msg: ServerMessage = JSON.parse(data.data);
      console.log("Received message", msg);
      if (msg.type in this.listeners) {
        this.listeners[msg.type].forEach(f => f(msg));
      }
    };
  }

  send(message: ClientMessage) {
    console.log("Sending message", message);
    this.ws.send(JSON.stringify(message));
  }

  addListener(type: string, listener: Listener) {
    if (!(type in this.listeners)) {
      this.listeners[type] = [];
    }

    this.listeners[type].push(listener);
  }
}

export let ClientContext = React.createContext<Client | null>(null);
