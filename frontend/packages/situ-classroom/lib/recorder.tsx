import { observer } from "mobx-react";
import React, { useContext, useEffect, useState } from "react";

import { LessonContext, RecorderState } from "./lesson";

let Download = () => {
  let lesson = useContext(LessonContext)!;

  let [zipUrl, setZipUrl] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      let url = await lesson.save();
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
  let lesson = useContext(LessonContext)!;
  // let replayer = useContext(ReplayContext)!;
  // let recorder = useContext(RecordContext)!;

  useEffect(() => {
    (async () => {
      await lesson.eachComponentAsync(c => c.setupRecording());
      lesson.recording = RecorderState.Ready;
    })();
  }, []);

  let views: { [_state: number]: React.FC } = {
    [RecorderState.Setup]: () => <>Setting up...</>,
    [RecorderState.Ready]: () => (
      <button
        onClick={async () => {
          lesson.recording = RecorderState.Preprocess;
          await lesson.eachComponentAsync(c => c.startRecording());
          lesson.recording = RecorderState.Recording;
        }}
      >
        Record
      </button>
    ),
    [RecorderState.Preprocess]: () => <>Initializing recording...</>,
    [RecorderState.Recording]: () => (
      <button
        onClick={async () => {
          lesson.recording = RecorderState.Postprocess;
          await lesson.eachComponentAsync(c => c.endRecording(lesson));
          lesson.recording = RecorderState.Completed;
        }}
      >
        Stop
      </button>
    ),
    [RecorderState.Postprocess]: () => <>Postprocessing recording...</>,
    [RecorderState.Completed]: () => <Download />,
  };
  let View = views[lesson.recording];

  return (
    <div className="recorder">
      <View />
    </div>
  );
});
