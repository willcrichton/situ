import axios from "axios";
import JSZip from "jszip";
import _ from "lodash";
import { action, makeAutoObservable, reaction } from "mobx";
import { observer } from "mobx-react";
import React, { useContext, useEffect, useRef, useState } from "react";

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

interface AlignedContent {
  from: number;
  to: number;
  time: { start: number; end: number } | null;
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

  alignContent(): AlignedContent[] {
    let transcriptChunkStart = 0;
    let transcriptIndex = 0;
    let alignmentIndex = 0;
    let pieces: AlignedContent[] = [];

    let flushChunk = () => {
      if (transcriptChunkStart != transcriptIndex) {
        let slice = this.transcript.slice(transcriptChunkStart, transcriptIndex);
        let from = transcriptChunkStart;
        slice.split("\n").forEach((substring, i) => {
          if (i > 0) {
            pieces.push({
              from,
              to: from + 1,
              time: null,
            });
            from += 1;
          }

          pieces.push({
            from,
            to: from + substring.length,
            time: null,
          });
          from += substring.length;
        });
      }
    };

    while (transcriptIndex < this.transcript.length && alignmentIndex < this.alignment.length) {
      let curWord = this.alignment[alignmentIndex];
      let length = curWord.word.length;
      if (this.transcript.slice(transcriptIndex, transcriptIndex + length) == curWord.word) {
        flushChunk();

        let wordEnd = transcriptIndex + length;
        pieces.push({
          from: transcriptIndex,
          to: wordEnd,
          time: { start: curWord.start * 1000, end: curWord.end * 1000 },
        });

        transcriptIndex = wordEnd;
        transcriptChunkStart = transcriptIndex;
        alignmentIndex += 1;
      } else {
        transcriptIndex += 1;
      }
    }
    flushChunk();

    return pieces;
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

  let [content] = useState(() => transcript.alignContent());

  useEffect(() => {
    let lastChild: HTMLElement | null = null;
    transcript.setReplayListener(time => {
      let i = _.findIndex(
        content,
        word => word.time != null && word.time.start <= time && time <= word.time.end
      );
      if (i == -1) return;
      let children = ref.current!.childNodes as NodeListOf<HTMLElement>;
      let child = _.find(children, child => child.dataset.word == i.toString())!;
      if (lastChild) {
        lastChild.style.textDecoration = "none";
      }
      child.style.textDecoration = "underline";
      lastChild = child;
    });
  }, []);

  return (
    <div ref={ref}>
      {content.map((word, i) => {
        let text = transcript.transcript.slice(word.from, word.to);
        if (text == "\n") {
          return <br key={i} />;
        } else {
          return (
            <code key={i} data-word={i}>
              {text}
            </code>
          );
        }
      })}
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
