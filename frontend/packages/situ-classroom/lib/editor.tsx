import {
  WebSocketMessageReader,
  WebSocketMessageWriter,
  toSocket,
} from "@codingame/monaco-jsonrpc";
import MonacoEditor from "@monaco-editor/react";
import { action, reaction } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import { editor } from "monaco-editor";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import {
  CloseAction,
  ErrorAction,
  MessageTransports,
  MonacoLanguageClient,
  MonacoServices,
} from "monaco-languageclient";
import React, { useContext, useEffect, useRef } from "react";

import { Action } from "./actions";
import { ClientContext } from "./client";
import { LessonContext } from "./lesson";

// TODO: Move language client logic/config to separate file
function createLanguageClient(transports: MessageTransports): MonacoLanguageClient {
  return new MonacoLanguageClient({
    name: "rust-analyzer",
    clientOptions: {
      documentSelector: [{ language: "rust", pattern: "**/*.rs" }],
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart }),
      },
    },
    connectionProvider: {
      get: () => {
        return Promise.resolve(transports);
      },
    },
  });
}

enum EditorActionType {
  EditorChangeAction = 1,
  EditorSaveAction = 2,
}

interface EditorChangeAction {
  subtype: EditorActionType.EditorChangeAction;
  contents: string;
}

interface EditorSaveAction {
  subtype: EditorActionType.EditorSaveAction;
}

type EditorAction = Action & { type: "EditorAction" } & (EditorChangeAction | EditorSaveAction);

export let Editor = observer(() => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);

  let lesson = useContext(LessonContext)!;
  let client = useContext(ClientContext)!;

  function saveFile() {
    let contents = editorRef.current!.getValue();
    client.send({
      type: "SaveFile",
      path: state.path!,
      contents,
    });
  }

  let applyEdit = (contents: string) => {
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = JSON.parse(contents);
    editorRef.current?.executeEdits("recorder", edits);
  };

  function handleEditorDidMount(
    editor: editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco
  ) {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;

    client.addListener(
      "FileContents",
      action(message => {
        state.contents = message.contents;
        state.path = message.path;
      })
    );

    // Record changes made in editor
    editorRef.current.onDidChangeModelContent(event => {
      if (event.changes && lesson.isRecording()) {
        let action: EditorAction = {
          type: "EditorAction",
          subtype: EditorActionType.EditorChangeAction,
          contents: JSON.stringify(event.changes),
        };
        lesson.actions.addAction(action);
      }
    });

    // Apply lesson modifications to editor
    lesson.actions.addListener("EditorAction", (action: EditorAction) => {
      if (action.subtype == EditorActionType.EditorChangeAction) {
        applyEdit(action.contents);
      } else if (action.subtype == EditorActionType.EditorSaveAction) {
        saveFile();
      }
    });

    // Save file on ctrl + s
    editorRef.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
      saveFile();

      if (lesson.isRecording()) {
        let action: EditorAction = {
          type: "EditorAction",
          subtype: EditorActionType.EditorSaveAction,
        };
        lesson.actions.addAction(action);
      }
    });

    monacoInstance?.languages.register({
      id: "rust",
      extensions: [".rs"],
      aliases: ["rust", "rs", "RS", "Rust"],
    });

    MonacoServices.install(monacoInstance);
  }

  function handleContent(contents: string) {
    if (!editorRef.current || !monacoRef.current) {
      return;
    }

    const modelFile = monaco.Uri.parse(`file://${state.path!}`);
    const existingModel = monacoRef.current.editor.getModel(modelFile);

    // Update model content if exists, create one if not
    if (existingModel) {
      editorRef.current.setModel(existingModel);
      existingModel.setValue(state.contents);
    } else {
      const model = monacoRef.current.editor.createModel(state.contents, "rust", modelFile);
      editorRef.current.setModel(model);
    }

    if (!state.langClient) {
      // TODO: if the user switches cargo projects, reinitialize LSP

      // Connect to LSP port, passing current file path as query param
      const url = `ws://localhost:8081?absPath=${state.path}`;
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

        state.langClient = languageClient;
      };

      editorRef.current?.setValue(contents);
    }
  }

  let state = useLocalObservable<{
    contents: string;
    path: string | null;
    langClient: MonacoLanguageClient | null;
  }>(() => ({
    contents: "",
    path: null,
    langClient: null,
  }));

  useEffect(() => {
    return reaction(() => state.contents, handleContent);
  }, []);

  return (
    <div className="editor-wrapper">
      <div>
        File: <code>{state.path}</code>
      </div>
      <MonacoEditor height={"40vh"} onMount={handleEditorDidMount} defaultValue={state.contents} />
    </div>
  );
});
