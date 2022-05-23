import * as cm from "@codemirror/basic-setup";
import { rust } from "@codemirror/lang-rust";
import { action, reaction } from "mobx";
import { useLocalObservable } from "mobx-react";
import React, { useContext, useEffect, useRef } from "react";

import { ClientContext, FileContents } from "./client";

export let Editor = () => {
  let ref = useRef<HTMLDivElement>(null);
  let state = useLocalObservable(() => ({
    language: "rust",
    contents: "",
  }));
  let client = useContext(ClientContext)!;

  useEffect(() => {
    client.addListener(
      "FileContents",
      action((message: FileContents) => {
        state.contents = message.contents;
      })
    );
  }, []);

  useEffect(() => {
    let language = state.language == "rust" ? [rust()] : [];
    let editor = new cm.EditorView({
      state: cm.EditorState.create({
        doc: state.contents,
        extensions: [cm.basicSetup, language],
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

  return <div className="editor" ref={ref} />;
};
