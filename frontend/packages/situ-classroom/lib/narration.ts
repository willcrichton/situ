import JSZip from "jszip";
import { makeAutoObservable } from "mobx";

import { LessonComponent } from "./lesson";

class MicRecorder {
  private chunks: Blob[] = [];
  public audioBlob: Blob | null = null;

  constructor(private recorder: MediaRecorder) {}

  static async load() {
    let stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    let mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    let micRecorder = new MicRecorder(mediaRecorder);
    mediaRecorder.addEventListener("dataavailable", e => {
      if (e.data.size > 0) micRecorder.chunks.push(e.data);
    });
    return micRecorder;
  }

  startRecording() {
    this.recorder.start();
  }

  async stopRecording() {
    this.recorder.stop();

    // after MediaRecording.stop is called, it seems like the last chunk
    // takes some time to flush. need to figure out the specifics of this behavior.
    // in the short term, a hack: wait until we've reached a fixpoint
    return new Promise<void>((resolve, _reject) => {
      let lastChunks = -1;
      let interval = setInterval(() => {
        if (this.chunks.length == lastChunks) {
          this.audioBlob = new Blob(this.chunks);
          clearInterval(interval);
          resolve();
        } else {
          lastChunks = this.chunks.length;
        }
      }, 1000);
    });
  }
}

export class Narration implements LessonComponent {
  static FILENAME: string = "audio.webm";

  recorder: MicRecorder | null = null;
  audioBlob: Blob | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  async load(zip: JSZip) {
    let audioBlob = await zip.file(Narration.FILENAME)!.async("blob");
    this.audioBlob = audioBlob;
  }

  async save(zip: JSZip) {
    zip.file(Narration.FILENAME, this.audioBlob!);
  }

  startReplay() {
    let url = URL.createObjectURL(this.audioBlob!);
    let audio = new Audio(url);
    audio.play();
  }

  onReplay(_time: number) {}

  async setupRecording() {
    this.recorder = await MicRecorder.load();
  }

  async startRecording() {
    this.recorder!.startRecording();
  }

  async endRecording() {
    await this.recorder!.stopRecording();
    this.audioBlob = this.recorder!.audioBlob!;
  }
}
