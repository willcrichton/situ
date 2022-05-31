import JSZip from "jszip";
import { action, makeAutoObservable } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import React, { useContext, useEffect, useState } from "react";

export interface Action {
  type: string;
}

type Timed<T> = T & {
  timestamp: number;
};

let now = () => new Date().getTime();

export class RecordState {
  actions: Timed<Action>[] = [];
  audioChunks: Blob[] = [];
  audioUrl: string | null = null;
  start: number = 0;
  public recording: boolean = false;

  startRecording() {
    this.start = now();
    this.recording = true;
    makeAutoObservable(this);
  }

  stopRecording() {
    this.recording = false;

    // after MediaRecording.stop is called, it seems like the last chunk
    // takes some time to flush. need to figure out the specifics of this behavior.
    // in the short term, a hack: wait until we've reached a fixpoint
    let lastChunks = -1;
    let interval = setInterval(() => {
      if (this.audioChunks.length == lastChunks) {
        this.audioUrl = URL.createObjectURL(new Blob(this.audioChunks));
        clearInterval(interval);
      } else {
        lastChunks = this.audioChunks.length;
      }
    }, 1000);
  }

  addAction(action: Action) {
    this.actions.push({
      timestamp: now() - this.start,
      ...action,
    });
  }

  async toZip(): Promise<string> {
    let zip = new JSZip();
    zip.file("actions.json", JSON.stringify(this.actions));
    zip.file("audio.webm", new Blob(this.audioChunks));
    let blob = await zip.generateAsync({ type: "blob" });
    return URL.createObjectURL(blob);
  }

  async fromZip(content: ArrayBuffer) {
    let zip = new JSZip();
    await zip.loadAsync(content);

    let [audioBlob, actionsStr] = await Promise.all([
      zip.file("audio.webm")!.async("blob"),
      zip.file("actions.json")!.async("string"),
    ]);
    this.audioUrl = URL.createObjectURL(audioBlob);
    this.actions = JSON.parse(actionsStr);
  }
}

type ActionListener<T> = (action: T) => void;
export class ReplayState {
  listeners: { [key: string]: ActionListener<any> } = {};
  public replaying: boolean = false;

  constructor(readonly actions: RecordState) {}

  addListener<T extends Action>(key: string, f: ActionListener<T>) {
    this.listeners[key] = f;
  }

  replay() {
    let actions = this.actions.actions;
    let audio = new Audio(this.actions.audioUrl!);
    audio.play();

    let start = now();
    this.replaying = true;
    let interval = setInterval(() => {
      if (actions.length == 0) {
        this.replaying = false;
        clearInterval(interval);
      }

      let elapsed = now() - start;
      let i = 0;
      for (; i < actions.length; ++i) {
        let action = actions[i];
        if (action.timestamp < elapsed) {
          this.listeners[action.type](action);
        } else {
          break;
        }
      }
      actions = actions.slice(i);
    }, 33);
  }
}

export let RecordContext = React.createContext<RecordState | null>(null);
export let ReplayContext = React.createContext<ReplayState | null>(null);

let Download = () => {
  let recorder = useContext(RecordContext)!;

  let [zipUrl, setZipUrl] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      let url = await recorder.toZip();
      setZipUrl(url);
    })();
  }, []);

  return (
    <>
      {zipUrl ? (
        <a href={zipUrl} download="lesson.zip">
          Download
        </a>
      ) : (
        "Generating..."
      )}
    </>
  );
};

export let Recorder: React.FC = observer(() => {
  let replayer = useContext(ReplayContext)!;
  let recorder = useContext(RecordContext)!;

  let state = useLocalObservable<{
    stream: MediaStream | null;
    recorder: MediaRecorder | null;
    recording: boolean;
  }>(() => ({
    stream: null,
    recorder: null,
    recording: false,
  }));

  useEffect(() => {
    (async () => {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    })();
  }, []);

  let toggleRecording = () => {
    if (!state.recording) {
      if (!state.recorder) {
        state.recorder = new MediaRecorder(state.stream!, { mimeType: "audio/webm" });
        state.recorder.addEventListener(
          "dataavailable",
          action(function (e) {
            if (e.data.size > 0) recorder.audioChunks.push(e.data);
          })
        );
      }

      state.recorder.start();
      recorder.startRecording();
    } else {
      state.recorder!.stop();
      recorder.stopRecording();
    }

    state.recording = !state.recording;
  };
  let Upload = () => {
    return (
      <>
        <input
          type="file"
          onChange={async event => {
            let content = await event.target.files![0].arrayBuffer();
            await recorder.fromZip(content);
          }}
        />
      </>
    );
  };

  return (
    <div className="recorder">
      <button onClick={toggleRecording}>{state.recording ? "Stop" : "Record"}</button>
      {recorder.audioUrl && !state.recording ? <Download /> : null}
      <button onClick={() => replayer!.replay()}>Replay</button>
      <Upload />
    </div>
  );
});
