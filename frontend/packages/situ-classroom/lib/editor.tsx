import MonacoEditor from "@monaco-editor/react";
import { action, reaction } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import { editor } from "monaco-editor";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { MonacoLanguageClient } from "monaco-languageclient";
import React, { useContext } from "react";

import { Action } from "./actions";
import { ClientContext } from "./client";
import { EditorHandler } from "./editor-handler";
import { LessonContext } from "./lesson";

export enum EditorActionType {
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

export type EditorAction = Action & { type: "EditorAction" } & (
    | EditorChangeAction
    | EditorSaveAction
  );

export type EditorState = {
  contents: string;
  path: string | null;
  langClient: MonacoLanguageClient | null;
};

export let Editor = observer(() => {
  let lesson = useContext(LessonContext)!;
  let client = useContext(ClientContext)!;

  let state = useLocalObservable<EditorState>(() => ({
    contents: "",
    path: null,
    langClient: null,
  }));

  function handleEditorDidMount(
    editor: editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco
  ) {
    let editorHandler = new EditorHandler(editor, monacoInstance, client, lesson, state);
    editorHandler.registerEditorCallbacks();

    client.addListener(
      "FileContents",
      action(message => {
        state.contents = message.contents;
        state.path = message.path;
      })
    );

    reaction(() => state.contents, editorHandler.handleContent);
  }

  return (
    <div className="editor-wrapper">
      <div>
        File: <code>{state.path}</code>
      </div>
      <MonacoEditor
        height={"40vh"}
        onMount={handleEditorDidMount}
        options={{ minimap: { enabled: false } }}
      />
    </div>
  );
});
