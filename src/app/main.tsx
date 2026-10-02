import { render } from "preact";

declare const __WORKER_SOURCE__: string;
declare const __DEV__: boolean;

function App() {
  return <main style={{ padding: "2rem", fontFamily: "serif" }}>Palimpsest — under construction.</main>;
}

render(<App />, document.getElementById("app")!);
