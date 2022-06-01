import axios from "axios";
import JSZip from "jszip";
import _ from "lodash";
import { action, makeAutoObservable, reaction } from "mobx";
import { observer } from "mobx-react";
import React, { useContext, useEffect, useRef } from "react";

import { Lesson, LessonComponent, LessonContext } from "./lesson";

// import showdown from "showdown";

export interface Word {
  alignedWord: string;
  word: string;
  case: string;
  start: number;
  startOffset: number;
  end: number;
  endOffset: number;
}

export class Transcript implements LessonComponent {
  static TEXT_FILENAME: string = "transcript.txt";
  static ALIGNMENT_FILENAME: string = "alignment.json";

  public transcript: string = "";
  public alignment: Word[] = [];
  private replayListener: (time: number) => void = () => {};

  constructor() {
    makeAutoObservable(this);
  }

  async load(zip: JSZip) {
    let [transcript, alignmentStr] = await Promise.all([
      zip.file(Transcript.TEXT_FILENAME)!.async("string"),
      zip.file(Transcript.ALIGNMENT_FILENAME)!.async("string"),
    ]);
    this.transcript = transcript;
    this.alignment = JSON.parse(alignmentStr);
  }

  async save(zip: JSZip) {
    zip.file(Transcript.TEXT_FILENAME, this.transcript);
    zip.file(Transcript.ALIGNMENT_FILENAME, JSON.stringify(this.alignment));
  }

  startReplay() {}
  onReplay(time: number) {
    this.replayListener(time);
  }
  setReplayListener(f: (time: number) => void) {
    this.replayListener = f;
  }

  async setupRecording() {}
  async startRecording() {}
  async endRecording(lesson: Lesson): Promise<void> {
    return new Promise(resolve => {
      let dispose = reaction(
        () => lesson.narration.audioBlob,
        audioBlob => {
          if (audioBlob) {
            dispose();
            this.runAligner(audioBlob).then(resolve);
          }
        }
      );
    });
  }

  async runAligner(audio: Blob) {
    let data = new FormData();
    data.append("audio", audio);
    data.append("transcript", this.transcript);
    let response = await axios.post("http://localhost:8765/transcriptions?async=false", data);
    this.alignment = response.data.words;
  }
}

let TranscriptEditorView: React.FC = observer(() => {
  let lesson = useContext(LessonContext)!;
  let transcript = lesson.transcript;
  let ref = useRef<HTMLTextAreaElement>(null);
  return (
    <textarea
      ref={ref}
      onChange={action(e => {
        transcript.transcript = e.target.value;
      })}
      value={transcript.transcript}
    />
  );
});

let TranscriptReaderView: React.FC = () => {
  let lesson = useContext(LessonContext)!;
  let transcript = lesson.transcript;
  let ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let lastIndex = -1;
    transcript.setReplayListener(time => {
      let i = _.findIndex(
        transcript.alignment,
        word => word.start * 1000 < time && time < word.end * 1000
      );
      if (i == -1 || i == lastIndex) return;
      let parent = ref.current!;
      let child = parent.childNodes[i] as HTMLSpanElement;
      if (i > 0) {
        let prevChild = parent.childNodes[i - 1] as HTMLSpanElement;
        prevChild.style.textDecoration = "none";
      }
      child.style.textDecoration = "underline";
      lastIndex = i;
    });
  }, []);

  return (
    <div ref={ref}>
      {transcript.alignment.map((word, i) => (
        <>
          <span key={i}>{word.word}</span>{" "}
        </>
      ))}
    </div>
  );
};

export let TranscriptView: React.FC = observer(() => {
  let lesson = useContext(LessonContext)!;

  return (
    <div className="transcript">
      {lesson.editing ? <TranscriptEditorView /> : <TranscriptReaderView />}
    </div>
  );
});
