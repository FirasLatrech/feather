import { Composition } from "remotion";
import { Trailer, TOTAL_FRAMES } from "./Trailer";

export const Root = () => (
  <>
    <Composition id="Trailer" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={60} width={1920} height={1080} />
  </>
);
