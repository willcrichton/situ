import {
  WebSocketMessageReader,
  WebSocketMessageWriter,
  toSocket,
} from "@codingame/monaco-jsonrpc";
import { editor } from "monaco-editor";
import * as monacoImport from "monaco-editor/esm/vs/editor/editor.api";
import {
  CloseAction,
  ErrorAction,
  MessageTransports,
  MonacoLanguageClient,
  MonacoServices,
} from "monaco-languageclient";

import { Client } from "./client";
import { EditorAction, EditorActionType, EditorState } from "./editor";
import { Lesson } from "./lesson";

export class EditorHandler {
  editor: editor.IStandaloneCodeEditor;
  monaco: typeof monacoImport;
  client: Client;
  lesson: Lesson;
  state: EditorState;

  constructor(
    editor: editor.IStandaloneCodeEditor,
    monaco: typeof monacoImport,
    client: Client,
    lesson: Lesson,
    state: EditorState
  ) {
    this.editor = editor;
    this.monaco = monaco;
    this.client = client;
    this.lesson = lesson;
    this.state = state;

    monaco.languages.register({
      id: "rust",
      extensions: [".rs"],
      aliases: ["rust", "rs", "RS", "Rust"],
    });

    MonacoServices.install(monaco);
  }

  applyEdit = (contents: string) => {
    const edits = JSON.parse(contents);
    this.editor?.executeEdits("recorder", edits);
  };

  saveFile = () => {
    let contents = this.editor?.getValue();
    this.client.send({
      type: "SaveFile",
      path: this.state.path!,
      contents,
    });
  };

  registerEditorCallbacks = () => {
    // Record changes made in editor
    this.editor?.onDidChangeModelContent(event => {
      if (event.changes && this.lesson.isRecording()) {
        let action: EditorAction = {
          type: "EditorAction",
          subtype: EditorActionType.EditorChangeAction,
          contents: JSON.stringify(event.changes),
        };
        this.lesson.actions.addAction(action);
      }
    });

    // Apply lesson modifications to editor
    this.lesson.actions.addListener("EditorAction", (action: EditorAction) => {
      if (action.subtype == EditorActionType.EditorChangeAction) {
        this.applyEdit(action.contents);
      } else if (action.subtype == EditorActionType.EditorSaveAction) {
        this.saveFile();
      }
    });

    // Save file on ctrl + s
    this.editor?.addCommand(monacoImport.KeyMod.CtrlCmd | monacoImport.KeyCode.KeyS, () => {
      this.saveFile();

      if (this.lesson.isRecording()) {
        let action: EditorAction = {
          type: "EditorAction",
          subtype: EditorActionType.EditorSaveAction,
        };
        this.lesson.actions.addAction(action);
      }
    });
  };

  handleContent = (contents: string) => {
    const modelFile = this.monaco.Uri.parse(`file://${this.state.path!}`);
    const existingModel = this.monaco.editor.getModel(modelFile);

    // Update model content if exists, create one if not
    if (existingModel) {
      this.editor.setModel(existingModel);
      existingModel.setValue(this.state.contents);
    } else {
      const model = this.monaco.editor.createModel(this.state.contents, "rust", modelFile);
      this.editor.setModel(model);
    }

    if (!this.state.langClient) {
      // TODO: if the user switches cargo projects, reinitialize LSP

      // Connect to LSP port, passing current file path as query param
      const url = `ws://localhost:8081?absPath=${this.state.path}`;
      const webSocket = new WebSocket(url);

      webSocket.onopen = () => {
        const socket = toSocket(webSocket);
        const reader = new WebSocketMessageReader(socket);
        const writer = new WebSocketMessageWriter(socket);
        const languageClient = createLanguageClient({
          reader,
          writer,
        });

        languageClient.start();
        reader.onClose(() => languageClient.stop());

        this.state.langClient = languageClient;
      };

      this.editor.setValue(contents);

      webSocket.addEventListener("message", ev => console.log(ev.data));
    }
  };
}

export const createLanguageClient = (transports: MessageTransports): MonacoLanguageClient => {
  return new MonacoLanguageClient({
    name: "rust-analyzer",
    clientOptions: {
      documentSelector: [{ language: "rust", pattern: "**/*.rs" }],
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart }),
      },
      middleware: {
        // Disable CodeLens (run, debug, etc)
        provideCodeLenses: () => undefined,
      },
    },
    connectionProvider: {
      get: () => {
        return Promise.resolve(transports);
      },
    },
  });
};
