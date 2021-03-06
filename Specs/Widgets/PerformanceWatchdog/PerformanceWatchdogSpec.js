/*global defineSuite*/
defineSuite([
         'Widgets/PerformanceWatchdog/PerformanceWatchdog',
         'Core/Ellipsoid',
         'Specs/createScene',
         'Specs/destroyScene',
         'Specs/EventHelper'
     ], function(
         PerformanceWatchdog,
         Ellipsoid,
         createScene,
         destroyScene,
         EventHelper) {
    "use strict";
    /*global jasmine,describe,xdescribe,it,xit,expect,beforeEach,afterEach,beforeAll,afterAll,spyOn,runs,waits,waitsFor*/

    var scene;
    beforeAll(function() {
        scene = createScene();
    });

    afterAll(function() {
        destroyScene(scene);
    });

    it('can create and destroy', function() {
        var container = document.createElement('span');
        container.id = 'testContainer';
        document.body.appendChild(container);

        var widget = new PerformanceWatchdog({
            container : 'testContainer',
            scene : scene
        });
        expect(widget.container).toBe(container);
        expect(widget.isDestroyed()).toEqual(false);

        widget.destroy();
        expect(widget.isDestroyed()).toEqual(true);

        document.body.removeChild(container);
    });

    it('throws if description is undefined', function() {
        expect(function() {
            return new PerformanceWatchdog(undefined);
        }).toThrowDeveloperError();
    });

    it('throws if description.container is undefined', function() {
        expect(function() {
            return new PerformanceWatchdog({
                container : undefined,
                scene : scene
            });
        }).toThrowDeveloperError();
    });

    it('throws if description.scene is undefined', function() {
        var container = document.createElement('span');
        container.id = 'testContainer';
        document.body.appendChild(container);

        expect(function() {
            return new PerformanceWatchdog({
                container : container,
                scene : undefined
            });
        }).toThrowDeveloperError();

        document.body.removeChild(container);
    });

    it('constructor throws with string element that does not exist', function() {
        expect(function() {
            return new PerformanceWatchdog({
                container : 'does not exist',
                scene : scene
            });
        }).toThrowDeveloperError();
    });
});