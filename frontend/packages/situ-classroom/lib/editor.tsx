import * as cm from "@codemirror/basic-setup";
import { rust } from "@codemirror/lang-rust";
import { keymap } from "@codemirror/view";
import { action, reaction } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import React, { useContext, useEffect, useRef } from "react";

import { ClientContext, FileContents } from "./client";
import { Action, RecordContext, ReplayContext } from "./recorder";

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
  let recorder = useContext(RecordContext);
  let replayer = useContext(ReplayContext);
  let ref = useRef<HTMLDivElement>(null);
  let state = useLocalObservable<{
    language: string;
    contents: string;
    path: string | null;
  }>(() => ({
    language: "rust",
    contents: "",
    path: null,
  }));
  let client = useContext(ClientContext)!;

  useEffect(() => {
    client.addListener(
      "FileContents",
      action((message: FileContents) => {
        state.contents = message.contents;
        state.path = message.path;
      })
    );
  }, []);

  useEffect(() => {
    let language = state.language == "rust" ? [rust()] : [];

    let saveFile = (editorState: cm.EditorState) => {
      let contents = editorState.doc.toJSON().join("\n");
      client.send({
        type: "SaveFile",
        path: state.path!,
        contents,
      });
    };

    let keyBindings = keymap.of([
      {
        key: "c-s",
        mac: "m-s",
        run(target) {
          saveFile(target.state);

          if (recorder) {
            let action: EditorAction = {
              type: "EditorAction",
              subtype: EditorActionType.EditorSaveAction,
            };
            recorder!.addAction(action);
          }
          return false;
        },
        preventDefault: true,
      },
    ]);

    let recordExt = recorder
      ? [
          cm.EditorView.updateListener.of(update => {
            if (update.docChanged) {
              let action: EditorAction = {
                type: "EditorAction",
                subtype: EditorActionType.EditorChangeAction,
                contents: update.state.doc.toJSON().join("\n"),
              };
              recorder!.addAction(action);
            }
          }),
        ]
      : [];

    let editor = new cm.EditorView({
      state: cm.EditorState.create({
        doc: state.contents,
        extensions: [cm.basicSetup, language, keyBindings, recordExt],
      }),
      parent: ref.current!,
    });

    let setContents = (contents: string) => {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: contents },
      });
    };

    if (replayer) {
      replayer.addListener("EditorAction", (action: EditorAction) => {
        if (action.subtype == EditorActionType.EditorChangeAction) {
          setContents(action.contents);
        } else if (action.subtype == EditorActionType.EditorSaveAction) {
          saveFile(editor.state);
        }
      });
    }

    return reaction(() => state.contents, setContents);
  }, []);

  return (
    <div className="editor-wrapper" style={{ display: state.path ? "block" : "none" }}>
      <div>
        File: <code>{state.path}</code>
      </div>
      <div className="editor" ref={ref} />
    </div>
  );
});
