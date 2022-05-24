import { action } from "mobx";
import { observer, useLocalObservable } from "mobx-react";
import React, { useContext, useEffect } from "react";

export interface Action {
  type: string;
}

type Timed<T> = T & {
  timestamp: number;
};

let now = () => new Date().getTime();

export class Actions {
  actions: Timed<Action>[] = [];
  start: number = 0;

  startRecording() {
    this.start = now();
  }

  addAction(action: Action) {
    this.actions.push({
      timestamp: now() - this.start,
      ...action,
    });
    console.log(this.actions);
  }
}

type ActionListener<T> = (action: T) => void;
export class Replayer {
  listeners: { [key: string]: ActionListener<any> } = {};

  constructor(readonly actions: Actions) {}

  addListener<T extends Action>(key: string, f: ActionListener<T>) {
    this.listeners[key] = f;
  }

  replay() {
    let actions = this.actions.actions;
    console.log("Replaying", actions);
    let start = now();
    setInterval(() => {
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

export let RecorderContext = React.createContext<Actions | null>(null);
export let ReplayContext = React.createContext<Replayer | null>(null);

export let Recorder: React.FC = observer(() => {
  let replayer = useContext(ReplayContext)!;
  let recorder = useContext(RecorderContext)!;

  let state = useLocalObservable<{
    stream: MediaStream | null;
    recorder: MediaRecorder | null;
    chunks: Blob[];
    recording: boolean;
  }>(() => ({
    stream: null,
    recorder: null,
    chunks: [],
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
        let options = { mimeType: "audio/webm" };
        state.recorder = new MediaRecorder(state.stream!, options);
        state.recorder.addEventListener(
          "dataavailable",
          action(function (e) {
            if (e.data.size > 0) state.chunks.push(e.data);
          })
        );
      }

      recorder.startRecording();
      state.recorder.start();
    } else {
      state.recorder!.stop();
    }

    state.recording = !state.recording;
  };

  return (
    <>
      <button onClick={toggleRecording}>{state.recording ? "Stop" : "Record"}</button>
      {state.chunks.length > 0 && !state.recording ? (
        <a href={URL.createObjectURL(new Blob(state.chunks))} download="audio.wav">
          Download
        </a>
      ) : null}
      <button onClick={() => replayer!.replay()}>Replay</button>
    </>
  );
});
