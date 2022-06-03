import * as cm from "@codemirror/basic-setup";
import { rust } from "@codemirror/lang-rust";
import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap } from "@codemirror/view";
import { action, reaction } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import React, { useContext, useEffect, useRef } from "react";

import { Action } from "./actions";
import { ClientContext } from "./client";
import { LessonContext } from "./lesson";
import { VisualizerContext } from "./visualizer";

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

let setVisualizerRanges = StateEffect.define<[number, number][]>();
let visualizerMark = Decoration.mark({ class: "cm-visualizer" });
let visualizerRanges = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(ranges, tr) {
    for (let e of tr.effects) {
      if (e.is(setVisualizerRanges)) {
        return RangeSet.of(e.value.map(([from, to]) => visualizerMark.range(from, to)));
      }
    }
    return ranges;
  },
  provide: f => EditorView.decorations.from(f),
});

export let Editor = observer(() => {
  let lesson = useContext(LessonContext)!;
  let client = useContext(ClientContext)!;
  let visualizer = useContext(VisualizerContext)!;

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

  useEffect(() => {
    client.addListener(
      "FileContents",
      action(message => {
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

          if (lesson.isRecording()) {
            let action: EditorAction = {
              type: "EditorAction",
              subtype: EditorActionType.EditorSaveAction,
            };
            lesson.actions.addAction(action);
          }

          return false;
        },
        preventDefault: true,
      },
    ]);

    let recordExt = cm.EditorView.updateListener.of(update => {
      if (update.docChanged && lesson.isRecording()) {
        let action: EditorAction = {
          type: "EditorAction",
          subtype: EditorActionType.EditorChangeAction,
          contents: update.state.doc.toJSON().join("\n"),
        };
        lesson.actions.addAction(action);
      }
    });

    let editor = new cm.EditorView({
      state: cm.EditorState.create({
        doc: state.contents,
        extensions: [cm.basicSetup, language, keyBindings, recordExt, visualizerRanges],
      }),
      parent: ref.current!,
    });

    let setContents = (contents: string) => {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: contents },
      });
    };

    lesson.actions.addListener("EditorAction", (action: EditorAction) => {
      if (action.subtype == EditorActionType.EditorChangeAction) {
        setContents(action.contents);
      } else if (action.subtype == EditorActionType.EditorSaveAction) {
        saveFile(editor.state);
      }
    });

    let d1 = reaction(
      () => visualizer.step,
      step => {
        if (step != -1) {
          let frame = visualizer.output![step];
          editor.dispatch({ effects: [setVisualizerRanges.of(frame.ranges)] });
        }
      }
    );

    let d2 = reaction(() => state.contents, setContents);

    return () => {
      d1();
      d2();
    };
  }, []);

  return (
    <div className="editor-wrapper">
      <div>
        File: <code>{state.path}</code>
      </div>
      <div className="editor" ref={ref} />
    </div>
  );
});
