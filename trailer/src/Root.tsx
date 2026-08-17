import { Composition } from "remotion";
import { Trailer, TOTAL_FRAMES } from "./Trailer";

export const Root = () => (
  <>
    <Composition id="Trailer" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="TrailerSquare" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={30} width={1080} height={1080} />
  </>
);
