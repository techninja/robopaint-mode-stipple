/**
 * @file Holds all RoboPaint manual/auto painting mode specific code
 */

// Initialize the RoboPaint canvas Paper.js extensions & layer management.
rpRequire('paper_utils')(paper);
rpRequire('auto_fill')(paper);
require('./paper.auto.stippleStroke.js')(paper);


// Animation frame callback
function onFrame(event) {
  canvas.onFrame(event);
  paper.fill.onFrameStep();
  paper.stippleStroke.onFrameStep();
}

paper.resetAll = function() {
  paper.fill.shutdown();
  paper.stippleStroke.shutdown();
};

canvas.paperInit(paper);
