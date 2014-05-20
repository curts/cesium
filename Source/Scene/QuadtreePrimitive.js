/*global define*/
define([
        '../Core/Cartesian3',
        '../Core/Cartographic',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/DeveloperError',
        '../Core/EllipsoidalOccluder',
        '../Core/getTimestamp',
        '../Core/Queue',
        './QuadtreeOccluders',
        './QuadtreeTile',
        './QuadtreeTileState',
        './SceneMode',
        './TileReplacementQueue'
    ], function(
        Cartesian3,
        Cartographic,
        defaultValue,
        defined,
        defineProperties,
        DeveloperError,
        EllipsoidalOccluder,
        getTimestamp,
        Queue,
        QuadtreeOccluders,
        QuadtreeTile,
        QuadtreeTileState,
        SceneMode,
        TileReplacementQueue) {
    "use strict";

    var QuadtreePrimitive = function QuadtreePrimitive(description) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(description) || !defined(description.tileProvider)) {
            throw new DeveloperError('description.tileProvider is required.');
        }
        //>>includeEnd('debug');

        this._tileProvider = description.tileProvider;
        this._tileProvider.quadtree = this;

        this._debug = {
                enableDebugOutput : false,

                maxDepth : 0,
                tilesVisited : 0,
                tilesCulled : 0,
                tilesRendered : 0,
                tilesWaitingForChildren : 0,

                lastMaxDepth : -1,
                lastTilesVisited : -1,
                lastTilesCulled : -1,
                lastTilesRendered : -1,
                lastTilesWaitingForChildren : -1,

                suspendLodUpdate : false
            };

        var tilingScheme = this._tileProvider.tilingScheme;
        var ellipsoid = tilingScheme.ellipsoid;

        this._tilesToRender = [];
        this._tileTraversalQueue = new Queue();
        this._tileLoadQueue = [];
        this._tileReplacementQueue = new TileReplacementQueue();
        this._levelZeroTiles = undefined;
        this._levelZeroTilesReady = false;

        /**
         * Gets or sets the maximum screen-space error, in pixels, that is allowed.
         * A higher maximum error will render fewer tiles and improve performance, while a lower
         * value will improve visual quality.
         * @type {Number}
         * @default 2
         */
        this.maximumScreenSpaceError = 2;

        /**
         * Gets or sets the maximum number of tiles that will be retained in the tile cache.
         * Note that tiles will never be unloaded if they were used for rendering the last
         * frame, so the actual number of resident tiles may be higher.  The value of
         * this property will not affect visual quality.
         * @type {Number}
         * @default 100
         */
        this.tileCacheSize = 100;

        this._occluders = new QuadtreeOccluders({
            ellipsoid : ellipsoid
        });
    };

    defineProperties(QuadtreePrimitive.prototype, {
        /**
         * Gets the provider of {@link QuadtreeTile} instances for this quadtree.
         * @type {QuadtreeTile}
         * @memberof QuadtreePrimitive.prototype
         */
        tileProvider : {
            get : function() {
                return this._tileProvider;
            }
        }
    });

    QuadtreePrimitive.prototype.invalidateAllTiles = function() {
        // Clear the replacement queue
        var replacementQueue = this._tileReplacementQueue;
        replacementQueue.head = undefined;
        replacementQueue.tail = undefined;
        replacementQueue.count = 0;

        // Free and recreate the level zero tiles.
        var levelZeroTiles = this._levelZeroTiles;
        if (defined(levelZeroTiles)) {
            for (var i = 0; i < levelZeroTiles.length; ++i) {
                levelZeroTiles[i].freeResources();
            }
        }

        this._levelZeroTiles = undefined;
    };

    QuadtreePrimitive.prototype.forEachLoadedTile = function(tileFunction) {
        var tile = this._tileReplacementQueue.head;
        while (defined(tile)) {
            tileFunction(tile);
            tile = tile.replacementNext;
        }
    };

    QuadtreePrimitive.prototype.update = function(context, frameState, commandList) {
        this._tileProvider.beginFrame(context, frameState, commandList);

        selectTilesForRendering(this, context, frameState);
        processTileLoadQueue(this, context, frameState);
        createRenderCommandsForSelectedTiles(this, context, frameState, commandList);

        this._tileProvider.endFrame(context, frameState, commandList);
    };

    var scratchCameraPositionCartographic = new Cartographic();

    function selectTilesForRendering(primitive, context, frameState) {
        var debug = primitive._debug;

        if (debug.suspendLodUpdate) {
            return;
        }

        var i, j, len;

        // Clear the render list.
        var tilesToRender = primitive._tilesToRender;
        tilesToRender.length = 0;

        var traversalQueue = primitive._tileTraversalQueue;
        traversalQueue.clear();

        debug.maxDepth = 0;
        debug.tilesVisited = 0;
        debug.tilesCulled = 0;
        debug.tilesRendered = 0;
        debug.tilesWaitingForChildren = 0;

        primitive._tileLoadQueue.length = 0;
        primitive._tileReplacementQueue.markStartOfRenderFrame();

        // We can't render anything before the level zero tiles exist.
        if (!defined(primitive._levelZeroTiles)) {
            if (primitive._tileProvider.ready) {
                var terrainTilingScheme = primitive._tileProvider.tilingScheme;
                primitive._levelZeroTiles = QuadtreeTile.createLevelZeroTiles(terrainTilingScheme);
            } else {
                // Nothing to do until the provider is ready.
                return;
            }
        }

        var cameraPosition = frameState.camera.positionWC;

        var ellipsoid = primitive._tileProvider.tilingScheme.ellipsoid;
        var cameraPositionCartographic = ellipsoid.cartesianToCartographic(cameraPosition, scratchCameraPositionCartographic);

        primitive._occluders.ellipsoid.cameraPosition = cameraPosition;

        var tile;

        // Enqueue the root tiles that are renderable and visible.
        var levelZeroTiles = primitive._levelZeroTiles;
        for (i = 0, len = levelZeroTiles.length; i < len; ++i) {
            tile = levelZeroTiles[i];
            primitive._tileReplacementQueue.markTileRendered(tile);
            if (tile.needsLoading) {
                queueTileLoad(primitive, tile);
            }
            if (tile.renderable && isTileVisible(primitive, frameState, tile)) {
                traversalQueue.enqueue(tile);
            } else {
                ++debug.tilesCulled;
                if (!tile.renderable) {
                    ++debug.tilesWaitingForChildren;
                }
            }
        }

        // Traverse the tiles in breadth-first order.
        // This ordering allows us to load bigger, lower-detail tiles before smaller, higher-detail ones.
        // This maximizes the average detail across the scene and results in fewer sharp transitions
        // between very different LODs.
        while (defined((tile = traversalQueue.dequeue()))) {
            ++debug.tilesVisited;

            primitive._tileReplacementQueue.markTileRendered(tile);

            if (tile.level > debug.maxDepth) {
                debug.maxDepth = tile.level;
            }

            // There are a few different algorithms we could use here.
            // This one doesn't load children unless we refine to them.
            // We may want to revisit this in the future.

            if (screenSpaceError(primitive, context, frameState, cameraPosition, cameraPositionCartographic, tile) < primitive.maximumScreenSpaceError) {
                // This tile meets SSE requirements, so render it.
                addTileToRenderList(primitive, tile);
            } else if (queueChildrenLoadAndDetermineIfChildrenAreAllRenderable(primitive, frameState, tile)) {
                // SSE is not good enough and children are loaded, so refine.
                var children = tile.children;
                // PERFORMANCE_IDEA: traverse children front-to-back so we can avoid sorting by distance later.
                for (i = 0, len = children.length; i < len; ++i) {
                    if (isTileVisible(primitive, frameState, children[i])) {
                        traversalQueue.enqueue(children[i]);
                    } else {
                        ++debug.tilesCulled;
                    }
                }
            } else {
                ++debug.tilesWaitingForChildren;
                // SSE is not good enough but not all children are loaded, so render this tile anyway.
                addTileToRenderList(primitive, tile);
            }
        }

        if (debug.enableDebugOutput) {
            if (debug.tilesVisited !== debug.lastTilesVisited ||
                debug.tilesRendered !== debug.lastTilesRendered ||
                debug.tilesCulled !== debug.lastTilesCulled ||
                debug.maxDepth !== debug.lastMaxDepth ||
                debug.tilesWaitingForChildren !== debug.lastTilesWaitingForChildren) {

                /*global console*/
                console.log('Visited ' + debug.tilesVisited + ', Rendered: ' + debug.tilesRendered + ', Culled: ' + debug.tilesCulled + ', Max Depth: ' + debug.maxDepth + ', Waiting for children: ' + debug.tilesWaitingForChildren);

                debug.lastTilesVisited = debug.tilesVisited;
                debug.lastTilesRendered = debug.tilesRendered;
                debug.lastTilesCulled = debug.tilesCulled;
                debug.lastMaxDepth = debug.maxDepth;
                debug.lastTilesWaitingForChildren = debug.tilesWaitingForChildren;
            }
        }
    }

    function screenSpaceError(primitive, context, frameState, cameraPosition, cameraPositionCartographic, tile) {
        if (frameState.mode === SceneMode.SCENE2D) {
            return screenSpaceError2D(primitive, context, frameState, cameraPosition, cameraPositionCartographic, tile);
        }

        var maxGeometricError = primitive._tileProvider.getLevelMaximumGeometricError(tile.level);

        var distance = primitive._tileProvider.getDistanceToTile(tile, frameState, cameraPosition, cameraPositionCartographic);
        tile.distance = distance;

        var height = context.drawingBufferHeight;

        var camera = frameState.camera;
        var frustum = camera.frustum;
        var fovy = frustum.fovy;

        // PERFORMANCE_IDEA: factor out stuff that's constant across tiles.
        return (maxGeometricError * height) / (2 * distance * Math.tan(0.5 * fovy));
    }

    function screenSpaceError2D(primitive, context, frameState, cameraPosition, cameraPositionCartographic, tile) {
        var camera = frameState.camera;
        var frustum = camera.frustum;
        var width = context.drawingBufferWidth;
        var height = context.drawingBufferHeight;

        var maxGeometricError = primitive._tileProvider.getLevelMaximumGeometricError(tile.level);
        var pixelSize = Math.max(frustum.top - frustum.bottom, frustum.right - frustum.left) / Math.max(width, height);
        return maxGeometricError / pixelSize;
    }

    function addTileToRenderList(primitive, tile) {
        primitive._tilesToRender.push(tile);
        ++primitive._debug.tilesRendered;
    }

    function isTileVisible(primitive, frameState, tile) {
        return primitive._tileProvider.isTileVisible(tile, frameState, primitive._occluders);
    }

    function queueChildrenLoadAndDetermineIfChildrenAreAllRenderable(primitive, frameState, tile) {
        var allRenderable = true;
        var allUpsampledOnly = true;

        var tileProvider = primitive._tileProvider;

        var children = tile.children;
        for (var i = 0, len = children.length; i < len; ++i) {
            var child = children[i];

            primitive._tileReplacementQueue.markTileRendered(child);

            allUpsampledOnly = allUpsampledOnly && child.upsampledFromParent;
            allRenderable = allRenderable && child.renderable;

            if (child.needsLoading) {
                queueTileLoad(primitive, child);
            }
        }

        if (!allRenderable) {
            ++primitive._debug.tilesWaitingForChildren;
        }

        // If all children are upsampled from this tile, we just render this tile instead of its children.
        return allRenderable && !allUpsampledOnly;
    }

    function queueTileLoad(primitive, tile) {
        primitive._tileLoadQueue.push(tile);
    }

    function processTileLoadQueue(primitive, context, frameState) {
        var tileLoadQueue = primitive._tileLoadQueue;
        var tileProvider = primitive._tileProvider;

        if (tileLoadQueue.length === 0) {
            return;
        }

        // Remove any tiles that were not used this frame beyond the number
        // we're allowed to keep.
        primitive._tileReplacementQueue.trimTiles(primitive.tileCacheSize);

        var startTime = getTimestamp();
        var timeSlice = primitive._loadQueueTimeSlice;
        var endTime = startTime + timeSlice;

        for (var len = tileLoadQueue.length - 1, i = len; i >= 0; --i) {
            var tile = tileLoadQueue[i];
            primitive._tileReplacementQueue.markTileRendered(tile);
            tileProvider.loadTile(context, frameState, tile);
            if (getTimestamp() >= endTime) {
                break;
            }
        }
    }

    function createRenderCommandsForSelectedTiles(primitive, context, frameState, commandList) {
        var tileProvider = primitive._tileProvider;
        var tilesToRender = primitive._tilesToRender;
        for (var i = 0, len = tilesToRender.length; i < len; ++i) {
            tileProvider.renderTile(tilesToRender[i], context, frameState, commandList);
        }
    }

    return QuadtreePrimitive;
});