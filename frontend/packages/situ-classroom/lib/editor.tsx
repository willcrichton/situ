import * as cm from "@codemirror/basic-setup";
import { rust } from "@codemirror/lang-rust";
import { keymap } from "@codemirror/view";
import { action, reaction } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import React, { useContext, useEffect, useRef } from "react";

import { ClientContext, FileContents } from "./client";

export let Editor = observer(() => {
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

    let keyBindings = keymap.of([
      {
        key: "c-s",
        mac: "m-s",
        run(target) {
          let contents = target.state.doc.toJSON().join("\n");
          client.send({
            type: "SaveFile",
            path: state.path!,
            contents,
          });
          return false;
        },
        preventDefault: true,
      },
    ]);

    let editor = new cm.EditorView({
      state: cm.EditorState.create({
        doc: state.contents,
        extensions: [cm.basicSetup, language, keyBindings],
      }),
      parent: ref.current!,
    });

    return reaction(
      () => state.contents,
      contents => {
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: contents },
        });
      }
    );
  }, []);

  console.log(state.path);
  return (
    <div className="editor-wrapper" style={{ display: state.path ? "block" : "none" }}>
      <div>
        File: <code>{state.path}</code>
      </div>
      <div className="editor" ref={ref} />
    </div>
  );
});
