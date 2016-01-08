/**
 * @file A cut down customized version of AutoStroke made just for stipples.
 * Contains all the required parts for managing flattening of art and
 * creation of toolpath lines for machine tracing strokes for stipple images.
 * Depends on canvas module, robopaint.
 */
 "use strict";
var _ = require('underscore');

// Settings template: pass any of these options in with the first setup argument
// to override. Second argument then becomes completion callback.
// These values are subject to change by global robopaint.settings defaults, See
// those values for current values.
var settings = {
  traceIterationMultiplier: 2, // Amount of work done in each frame.
  lineWidth: 10, // The size of the visual representation of the stroke line.
  flattenResolution: 15, // Stroke polygonal conversion resolution
};

// General state variables (reset via shutdown below)
var traceChildrenMax = 0;
var currentTraceChild = 0;
var runTraceSpooling = false;

module.exports = function(paper) {
  // Emulate PaperScript "Globals" as needed
  var Point = paper.Point;
  var Path = paper.Path;
  var Color = paper.Color;

  // Shortcuts for long lines.
  var snapColorID = paper.utils.snapColorID;
  var snapColor = paper.utils.snapColor;
  var getClosestIntersection = paper.utils.getClosestIntersection;

  paper.stippleStroke = {
    settings: settings,

    // Copy the needed parts for tracing (all paths with strokes) and their fills
    setup: function (overrides, callback) {
      if (_.isFunction(overrides)) callback = overrides; // No overrides

      // Get global Settings
      var set = robopaint.settings;

      var setMap = { // Map global settings to local stroke module settings.
        traceIterationMultiplier: parseInt(set.autostrokeiteration),
        lineWidth: parseInt(set.autostrokewidth),
        flattenResolution: set.strokeprecision * 4
      }

      // Merge in local settings, global settings, and passed overrides.
      settings = _.extend(settings, setMap, overrides);

      this.complete = callback; // Assign callback
      var tmp = paper.canvas.tempLayer;
      tmp.activate();
      tmp.removeChildren(); // Clear it out

       // Move through each temp item to prep them
      traceChildrenMax = settings.stipples.length;

      mode.run([
        ['status', i18n.t('libs.spool.stroke', {id: '0/' + traceChildrenMax}), true],
        ['progress', 0, traceChildrenMax]
      ]);

      // Begin the trace!
      runTraceSpooling = true;
      paper.canvas.actionLayer.activate();
    },

    onFrameStep: function() {
      for (var i = 0; i < settings.traceIterationMultiplier; i++) {
        if (runTraceSpooling) {
          if (!traceStrokeNext()) { // Check for trace complete
            this.shutdown();

            // Run complete callback, if set.
            if (_.isFunction(this.complete)) {
              this.complete();
            }
          }
        }
      }
    },

    shutdown: function() {
      runTraceSpooling = false;
      traceChildrenMax = 0;
      currentTraceChild = 0;
      runTraceSpooling = false;
    }
  };

  // Iterationally process each path to be traced from temp paths
  function traceStrokeNext() {
    if (currentTraceChild >= traceChildrenMax) {
      return false;
    }

    var cStip = settings.stipples[currentTraceChild];

    cStip.c = new Color(cStip.c);

    // Create each circle path
    var cPath = new Path({
      strokeColor: snapColor(cStip.c),
      strokeWidth: 2,
      fillColor: 'red',
      data: {
        color: snapColorID(cStip.c),
        name: 'stipple' + currentTraceChild,
        type: 'stroke'
      },
      // Approximate the circle with the four cardinal points.
      segments: [
        [cStip.x, cStip.y - cStip.r], // N
        [cStip.x + cStip.r, cStip.y], // E
        [cStip.x, cStip.y + cStip.r], // S
        [cStip.x - cStip.r, cStip.y], // W
        [cStip.x, cStip.y - cStip.r]  // N (back home)
      ]
    });

    // Ignore white paths (color id 8)
    // TODO: This should probably be handled depending on number of colors in the
    // media (you can have more pens than 8), paper color might not be white.
    if (cPath.data.color === 'color8') {
      cPath.remove(); return true;
    }

    mode.run('status', i18n.t('libs.spool.stroke', {id: (currentTraceChild+1) + '/' + traceChildrenMax}), true);
    mode.run('progress', currentTraceChild);

    currentTraceChild++;

    return true;
  }
 };
