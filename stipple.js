/**
 * @file Holds all RoboPaint example mode text renderer initialization code.
 *   @see the mode readme for all the goodies that modes come with. Also,
 *      any robopaint dependencies you add to the package JSON will be available
 *      as well, like jQuery $ and underscore _.
 */
"use strict";

var actualPen = {}; // Hold onto the latest actualPen object from updates.
var buffer = {};
var canvas = rpRequire('canvas');
var canvasBuffer = require('electron-canvas-to-buffer');
var t = i18n.t; // The mother of all shortcuts
var fs = require('fs-plus');
var path = require('path');
var exec = require('child_process').exec;
var stippleBusy = false;
var mainWindow = require('electron').remote.getCurrentWindow();

var bin = path.join(mode.path.dir, 'bin', process.platform, 'voronoi_stippler');
var tmpFile = path.join(app.getPath('temp'), 'stipple_temp.svg');
var tmpImg = path.join(app.getPath('temp'), 'stipple_temp.png');
var raster = null; // Placeholder raster object
var rasterDPI = 36; // Sets resolution of converted/rendered image
var printStarted = false;

mode.pageInitReady = function () {
  // Initialize the paper.js canvas with wrapper margin and other settings.
  canvas.domInit({
    replace: '#paper-placeholder', // jQuery selecter of element to replace
    paperScriptFile: 'stipple.ps.js', // The main PaperScript file to load
    wrapperMargin: {
      top: 30,
      left: 30,
      right: 265,
      bottom: 40
    },

    // Called when PaperScript init is complete, requires
    // canvas.paperInit(paper) to be called in this modes paperscript file.
    // Don't forget that!
    loadedCallback: paperLoadedInit
  });

  $(window).resize(responsiveResize);
}


function runStipple(options, callback) {
  if (stippleBusy || printStarted) return;
  var args = [];

  var defaults = {
    stipples: 500,
    color: true,
    threshold: 0.1,
    overlap: true,
    fixed: false,
    size: 1,
    subpixels: 5
  };

  options = _.extend(defaults, options);

  // Push arguments out to args array
  args.push('-s'); args.push(options.stipples);
  args.push('-t'); args.push(options.threshold);
  args.push('-z'); args.push(options.size);
  args.push('-p'); args.push(options.subpixels);

  if (options.color) args.push('-c');
  if (!options.overlap) args.push('-n');
  if (options.fixed) args.push('-f');

  // Add the source image
  args.push(tmpImg);

  // Add the destination SVG
  args.push(tmpFile);

  stippleBusy = true;
  var child = exec(bin + ' ' + args.join(' '));
  child.stdout.on('data', function(data) {
      if (data.includes("% Complete")) {
        var v = Math.min(100, parseInt(data.split('%')[0]));
        $('progress').show().val(v);
      }
  });

  child.on('close', function(code){
    $('progress').val(0).slideUp('slow');
    if (fs.existsSync(tmpFile)) {
      $('#preview')
        .attr('src', tmpFile + '?' + Math.ceil(Math.random() * 2000))
        .show();
      stippleBusy = false;
    }
  });
}

// Triggered on resize, move elements around
function responsiveResize() {
  var off = $('canvas').offset();
  $('#preview').css({
    left: off.left,
    top: off.top,
    width: $('canvas').width(),
    height: $('canvas').height()
  });

  $('progress').css({
    left: canvas.settings.wrapperMargin.left,
    top: canvas.settings.wrapperMargin.top,
    width: $('#paper-back').width()+2,
    border: 0
  });
}

// Callback that tells us that our Paper.js canvas is ready!
function paperLoadedInit() {
  console.log('Paper ready!');

  $(window).resize();
  // Use mode settings management on all "managed" class items. This
  // saves/loads settings from/into the elements on change/init.
  //mode.settings.$manage('.managed'); // DEBUG! ENABLE THIS WHEN READY

  // With Paper ready, send a single up to fill values for buffer & pen.
  mode.run('up');
}

// Catch CNCServer buffered callbacks
mode.onCallbackEvent = function(name) {
  switch (name) {
    case 'autoPaintBegin': // Should happen when we've just started
      $('#pause').prop('disabled', false); // Enable pause button
      break;
    case 'autoPaintComplete': // Should happen when we're completely done
      $('#pause').attr('class', 'ready')
        .text(robopaint.t('common.action.start'))
        .prop('disabled', false);
      $('#buttons button.normal').prop('disabled', false); // Enable options
      $('#cancel').prop('disabled', true); // Disable the cancel print button

      printStarted = false; // Reset print status

      break;
  }
};

// Load the raster image given at the path
function paperLoadImage(path, callback) {
  if (raster) raster.remove();

  $('#preview').attr('src', '');
  responsiveResize();
  paper.canvas.tempLayer.opacity = 1;
  paper.canvas.tempLayer.activate();
  raster = new paper.Raster({
    position: paper.view.center,
    source: path
  });

  // If you create a Raster using a url, you can use the onLoad
  // handler to do something once it is loaded:
  raster.onLoad = function() {
    raster.fitBounds(paper.view.bounds);
    paperSaveImage(callback);
  };
}

// Write paper canvas to file
function paperSaveImage(callback) {
  // Put a big white box in the background for IMG export.
  paper.canvas.tempLayer.activate();
  var tempRect = new paper.Path.Rectangle({
    rectangle: paper.view.bounds,
    fillColor: 'white'
  }).sendToBack();

  // Force Update for png export
  paper.view.update(true);

  var exportRaster = paper.canvas.tempLayer.rasterize(rasterDPI);
  var b = canvasBuffer(exportRaster.canvas, 'image/png');
  fs.writeFile(tmpImg, b, function (err) {
    if (err) {
      throw err;
    }

    // Put things back to the setup we had before exporting.
    tempRect.remove();
    exportRaster.remove();
    paper.view.update(true);
    if (callback) callback();
  })
}

function startPrint(callback) {
  if (printStarted) return false;

  printStarted = true;

  // Actually Load the SVG we've been previewing (and hide the preview)
  paper.canvas.mainLayer.activate();
  //paper.canvas.loadSVG(fs.readFileSync(tmpFile).toString(), true);
  //paper.canvas.mainLayer.children[0].fitBounds(paper.view.bounds);
  $('#preview').hide();

  // The amount to scale up the points to be in the same relative position.
  var scale = 2;

  // We need to get the image out of the way...
  raster.remove();
  paper.stippleStroke.setup({
    stipples: getStippleList(fs.readFileSync(tmpFile).toString(), scale)
  }, callback);
}


/**
 * Parse a complete SVG output stipple file to get its complete list of stipples
 * with their sizes and their positions.
 *
 * @param  {String} svg
 *   Direct SVG data from the file.
 * @param {Number} scale
 *   Amount to scale incoming values
 * @return {Array}
 *   Array of stipple objects.
 */
function getStippleList(svg, scale) {
  // We can parse the SVG very simply here because the output we get from the
  // Voronoi stippler is extremely regular, otherwise this kind of parsing would
  // be exceedingly inadvisable.
  var stipples = [];
  var lines = svg.split("\n");
  _.each(lines, function(line){
    if (line.includes('circle')) {
      var p = line.split('"');
      stipples.push({
        x: parseFloat(p[1]) * scale,
        y: parseFloat(p[3]) * scale,
        r: parseFloat(p[5]) * scale,
        c: p[7]
      });
    }
  });

  return stipples;
}

// Bind all controls (happens before pageInitReady, @see mode.preload.js)
mode.bindControls = function() {
  // Bind save functionality
  $('#save').click(function() {
    robopaint.svg.save(fs.readFileSync(tmpFile).toString());
  });

  // Cancel Print
  $('#cancel').click(function(){
    var cancelPrint = confirm(t("common.action.cancelconfirm"));
    if (cancelPrint) {
      mode.onCallbackEvent('autoPaintComplete');
      mode.fullCancel(mode.t('status.cancelled'));
      paper.resetAll();
    }
  });

  // Pick image
  $('#picker').click(function(){
    mainWindow.dialog({
      t: 'OpenDialog',
      title: mode.t('filepick.title'),
      filters: [
        { name: mode.t('filepick.files'), extensions: ['jpg', 'jpeg', 'gif', 'png'] }
      ]
    }, function(filePath){
      if (!filePath) {  // Open cancelled
        return;
      }

      paperLoadImage(filePath[0], function(){
        paper.canvas.tempLayer.opacity = 0.2;
        $('#color').change();
      });

    });
  });

  // Enable fancy checkboxes
  $('input[type="checkbox"].fancy').each(function(){
    var $item = $(this);
    // Extra div and click handler for "fancy" IOS checkbox style
    $item.after($('<div>').click(function(){ $item.click(); }));
  });

  // Bind pause click and functionality
  $('#pause').click(function() {

    // With nothing in the queue, start autopaint!
    if (buffer.length === 0) {
      $('#pause')
        .removeClass('ready')
        .attr('title', t("modes.print.status.pause"))
        .text(t('common.action.pause'))
        .prop('disabled', true);
      $('#buttons button.normal').prop('disabled', true); // Disable options
      $('#cancel').prop('disabled', false); // Enable the cancel print button

      // Actually start spooling/printing
      startPrint(function(){
        // TODO: Cleanup and reset for re-run
        paper.utils.autoPaint(paper.canvas.actionLayer);
      });

    } else {
      // With something in the queue... we're either pausing, or resuming
      if (!buffer.paused) {
        // Starting Pause =========
        $('#pause').prop('disabled', true).attr('title', t("status.wait"));
        mode.run([
          ['status', t("status.pausing")],
          ['pause']
        ], true); // Insert at the start of the buffer so it happens immediately

        mode.onFullyPaused = function(){
          mode.run('status', t("status.paused"));
          $('#buttons button.normal').prop('disabled', false); // Enable options
          $('#pause')
            .addClass('active')
            .attr('title', t("status.resume"))
            .prop('disabled', false)
            .text(t("common.action.resume"));
        };
      } else {
        // Resuming ===============
        $('#buttons button.normal').prop('disabled', true); // Disable options
        mode.run([
          ['status', t("status.resuming")],
          ['resume']
        ], true); // Insert at the start of the buffer so it happens immediately

        mode.onFullyResumed = function(){
          $('#pause')
            .removeClass('active')
            .attr('title', t("mode.print.status.pause"))
            .text(t('common.action.pause'));
          mode.run('status', t("status.resumed"));
        };
      }
    }
  });

  // Bind to managed form element change
  var opts = {};
  $('.managed').change(function(){
    var redoStipple = false; // Assume we don't need to

    // Re/Build full opts.
    $('.stipple.managed').each(function(){
      if (opts[this.id] !== getVal(this)) {
        opts[this.id] = getVal(this);
        redoStipple = true;
      }
    });

    // Non stipple options
    paper.canvas.tempLayer.opacity = $('#opacity').val()/100;
    paper.view.update();

    // Run stipple only if needed
    if (redoStipple) {
      runStipple(opts);
    }
  });

  $('#opacity').on('input', function(){
    // Non stipple options
    paper.canvas.tempLayer.opacity = $('#opacity').val()/100;
    paper.view.update();
  });

  // Bind to control buttons
  $('#park').click(function(){
    // If we're paused, skip the buffer
    mode.run([
      ['status', t("status.parking"), buffer.paused],
      ['park', buffer.paused], // TODO: If paused, only one message will show :/
      ['status', t("status.parked"), buffer.paused]
    ]);
  });


  $('#pen').click(function(){
    // Run height pos into the buffer, or skip buffer if paused
    var newState = 'up';
    if (actualPen.state === "up" || actualPen.state === 0) {
      newState = 'down';
    }

    mode.run(newState, buffer.paused);
  });

  // Motor unlock: Also lifts pen and zeros out.
  $('#disable').click(function(){
    mode.run([
      ['status', t("status.unlocking")],
      ['up'],
      ['zero'],
      ['unlock'],
      ['status', t("status.unlocked")]
    ]);
  });
}

// Warn the user on close about cancelling jobs.
mode.onClose = function(callback) {
  if (buffer.length) {
    var r = confirm(i18n.t('common.dialog.confirmexit'));
    if (r == true) {
      // As this is a forceful cancel, shove to the front of the queue
      mode.run(['clear', 'park', 'clearlocal'], true);
      callback(); // The user chose to close.
    }
  } else {
    callback(); // Close, as we have nothing the user is waiting on.
  }
}

function getVal(t) {
  return t.type === 'checkbox' ? $(t).prop('checked') : $(t).val();
}

// Actual pen update event
mode.onPenUpdate = function(botPen){
  paper.canvas.drawPoint.move(botPen.absCoord, botPen.lastDuration);
  actualPen = $.extend({}, botPen);

  // Update button text/state
  // TODO: change implement type <brush> based on actual implement selected!
  var key = 'common.action.brush.raise';
  if (actualPen.state === "up" || actualPen.state === 0){
    key = 'common.action.brush.lower';
  }
  $('#pen').text(t(key));
}

// An abbreviated buffer update event, contains paused/not paused & length.
mode.onBufferUpdate = function(b) {
  buffer = b;
}
