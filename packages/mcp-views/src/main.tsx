/** @jsxImportSource preact */
import { render } from "preact";

import { connectHostBridge } from "./bridge";
import { DayView } from "./DayView";
import "./day.css";

render(<DayView connect={connectHostBridge} />, document.getElementById("root")!);
