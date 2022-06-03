import React, { useRef, useState } from "react";
import * as ReactDOM from "react-dom/client";
import Split from "react-split";

import "../static/index.html";
import "../static/index.scss";
import { Client, ClientContext } from "./client";
import { Editor } from "./editor";
import { Lesson, LessonContext } from "./lesson";
import { Recorder } from "./recorder";
import { Shell } from "./shell";
import { TranscriptView } from "./transcript";
import { Visualizer, VisualizerContext, VisualizerState } from "./visualizer";

let LessonView: React.FC<{ lesson: Lesson }> = ({ lesson }) => {
  let [visState] = useState(() => new VisualizerState());
  return (
    <LessonContext.Provider value={lesson}>
      <VisualizerContext.Provider value={visState}>
        {lesson.editing ? <Recorder /> : null}
        <div className="container">
          <Split className="split horizontal" direction="horizontal">
            <Split className="split vertical" direction="vertical">
              <Editor />
              <Visualizer />
              <Shell />
            </Split>
            <TranscriptView />
          </Split>
        </div>
      </VisualizerContext.Provider>
    </LessonContext.Provider>
  );
};

let App: React.FC = () => {
  let [client] = useState(() => new Client());
  let [lesson, setLesson] = useState<Lesson | null>(null);
  let uploadRef = useRef<HTMLInputElement>(null);
  return (
    <ClientContext.Provider value={client}>
      {lesson ? (
        <LessonView lesson={lesson} />
      ) : (
        <div>
          <input
            ref={uploadRef}
            type="file"
            style={{ display: "none" }}
            onChange={async event => {
              let lesson = new Lesson(false);
              let zipBlob = event.target.files![0];
              await lesson.load(zipBlob);
              setLesson(lesson);
              lesson.startReplay();
            }}
          />
          <button onClick={() => uploadRef.current!.click()}>Upload a lesson</button> OR{" "}
          <button
            onClick={() => {
              setLesson(new Lesson(true));
            }}
          >
            Record a lesson
          </button>
        </div>
      )}
    </ClientContext.Provider>
  );
};

let root = ReactDOM.createRoot(document.getElementById("app")!);
root.render(<App />);
