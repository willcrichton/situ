import JSZip from "jszip";
import _ from "lodash";

import { LessonComponent } from "./lesson";

export interface Action {
  type: string;
}

export type Timed<T> = T & {
  timestamp: number;
};

type ActionListener<T> = (action: T) => void;
export class Actions implements LessonComponent {
  private actions: Timed<Action>[] = [];
  private listeners: { [key: string]: ActionListener<any> } = {};

  static FILENAME = "actions.json";
  async load(zip: JSZip) {
    let actionsStr = await zip.file("actions.json")!.async("string");
    this.actions = JSON.parse(actionsStr);
  }
  async save(zip: JSZip) {
    zip.file(Actions.FILENAME, JSON.stringify(this.actions));
  }

  private replayActions: Timed<Action>[] = [];
  addListener<T extends Action>(key: string, f: ActionListener<T>) {
    this.listeners[key] = f;
  }
  startReplay() {
    this.replayActions = this.actions;
  }
  onReplay(time: number) {
    let i = 0;
    for (; i < this.replayActions.length; ++i) {
      let action = this.replayActions[i];
      if (action.timestamp < time) {
        this.listeners[action.type](action);
      } else {
        break;
      }
    }
    this.replayActions = this.replayActions.slice(i);
  }

  // TODO: this should exist on Lesson, probably
  private recordingStart: number = 0;
  async setupRecording() {}
  async startRecording() {
    this.recordingStart = _.now();
  }
  async endRecording() {}

  addAction(action: Action) {
    this.actions.push({
      timestamp: _.now() - this.recordingStart,
      ...action,
    });
  }
}
