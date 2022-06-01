import JSZip from "jszip";
import _ from "lodash";
import { makeAutoObservable } from "mobx";
import React from "react";

import { Actions } from "./actions";
import { Narration } from "./narration";
import { Transcript } from "./transcript";

export interface LessonComponent {
  // I/O
  load(zip: JSZip): Promise<void>;
  save(zip: JSZip): Promise<void>;

  // Recording
  setupRecording(): Promise<void>;
  startRecording(): Promise<void>;
  endRecording(lesson: Lesson): Promise<void>;

  // Replay
  startReplay(): void;
  onReplay(time: Number): void;
}

export enum RecorderState {
  Setup,
  Preprocess,
  Ready,
  Recording,
  Postprocess,
  Completed,
}

export class Lesson {
  narration: Narration = new Narration();
  transcript: Transcript = new Transcript();
  actions: Actions = new Actions();
  recording: RecorderState = RecorderState.Setup;
  replayStart: number = 0;

  constructor(public editing: boolean) {
    makeAutoObservable(this);
  }

  isRecording(): boolean {
    return this.recording == RecorderState.Recording;
  }

  startReplay() {
    this.eachComponent(c => c.startReplay());
    let start = _.now();
    let loop = () => {
      this.eachComponent(c => c.onReplay(_.now() - start));
      // TODO: break on end, need to save duration of recording
      requestAnimationFrame(loop);
    };
    loop();
  }

  eachComponent(f: (c: LessonComponent) => void) {
    f(this.narration);
    f(this.transcript);
    f(this.actions);
  }

  async eachComponentAsync(f: (c: LessonComponent) => Promise<void>) {
    await Promise.all([f(this.narration), f(this.transcript), f(this.actions)]);
  }

  async load(zipBlob: Blob) {
    let zip = new JSZip();
    await zip.loadAsync(zipBlob);
    await this.eachComponentAsync(c => c.load(zip));
  }

  async save(): Promise<string> {
    let zip = new JSZip();
    await this.eachComponentAsync(c => c.save(zip));
    let blob = await zip.generateAsync({ type: "blob" });
    return URL.createObjectURL(blob);
  }
}

export let LessonContext = React.createContext<Lesson | null>(null);
