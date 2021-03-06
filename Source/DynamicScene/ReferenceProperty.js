/*global define*/
define([
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/DeveloperError',
        '../Core/RuntimeError',
        '../Core/Event',
        './Property'
    ], function(
        defined,
        defineProperties,
        DeveloperError,
        RuntimeError,
        Event,
        Property) {
    "use strict";

    function resolve(that) {
        var targetProperty = that._targetProperty;
        if (!defined(targetProperty)) {
            var targetObject = that._targetObject;

            if (!defined(targetObject)) {
                var targetCollection = that._targetCollection;

                targetObject = targetCollection.getById(that._targetId);
                if (!defined(targetObject)) {
                    throw new RuntimeError('target object could not be resolved.');
                }
                targetObject.definitionChanged.addEventListener(ReferenceProperty.prototype._onTargetObjectDefinitionChanged, that);
                that._targetObject = targetObject;
            }

            var names = that._targetPropertyNames;

            targetProperty = targetObject;
            var length = names.length;
            for (var i = 0; i < length; i++) {
                targetProperty = targetProperty[names[i]];
                if (!defined(targetProperty)) {
                    throw new RuntimeError('targetProperty could not be resolved.');
                }
            }

            that._targetProperty = targetProperty;
        }
        return targetProperty;
    }

    /**
     * A {@link Property} which transparently links to another property on a provided object.
     *
     * @alias ReferenceProperty
     * @constructor
     *
     * @param {targetCollection} targetCollection The object collection which will be used to resolve the reference.
     * @param {String} targetId The id of the object which is being referenced.
     * @param {String} targetPropertyNames The name of the property on the target object which we will use.
     *
     * @example
     * var collection = new Cesium.DynamicObjectCollection();
     *
     * //Create a new object and assign a billboard scale.
     * var object1 = new Cesium.DynamicObject('object1');
     * object1.billboard = new Cesium.DynamicBillboard();
     * object1.billboard.scale = new ConstantProperty(2.0);
     * collection.add(object1);
     *
     * //Create a second object and reference the scale from the first one.
     * var object2 = new Cesium.DynamicObject('object2');
     * object2.model = new Cesium.DynamicModel();
     * object2.model.scale = new Cesium.ReferenceProperty(collection, 'object1', ['billboard', 'scale']);
     * collection.add(object2);
     *
     * //Create a third object, but use the fromString helper function.
     * var object3 = new Cesium.DynamicObject('object3');
     * object3.billboard = new Cesium.DynamicBillboard();
     * object3.billboard.scale = Cesium.ReferenceProperty.fromString(collection, 'object1#billboard.scale']);
     * collection.add(object3);
     *
     * //You can refer to an object with a # or . in id and property names by escaping them.
     * var object4 = new Cesium.DynamicObject('#object.4');
     * object4.billboard = new Cesium.DynamicBillboard();
     * object4.billboard.scale = new ConstantProperty(2.0);
     * collection.add(object4);
     *
     * var object5 = new Cesium.DynamicObject('object5');
     * object5.billboard = new Cesium.DynamicBillboard();
     * object5.billboard.scale = Cesium.ReferenceProperty.fromString(collection, '\\#object\\.4#billboard.scale');
     * collection.add(object5);
     */
    var ReferenceProperty = function(targetCollection, targetId, targetPropertyNames) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(targetCollection)) {
            throw new DeveloperError('targetCollection is required.');
        }
        if (!defined(targetId) || targetId === '') {
            throw new DeveloperError('targetId is required.');
        }
        if (!defined(targetPropertyNames) || targetPropertyNames.length === 0) {
            throw new DeveloperError('targetPropertyNames is required.');
        }
        for (var i = 0; i < targetPropertyNames.length; i++) {
            var item = targetPropertyNames[i];
            if (!defined(item) || item === '') {
                throw new DeveloperError('reference contains invalid properties.');
            }
        }
        //>>includeEnd('debug');

        this._targetCollection = targetCollection;
        this._targetId = targetId;
        this._targetPropertyNames = targetPropertyNames;
        this._targetProperty = undefined;
        this._targetObject = undefined;
        this._definitionChanged = new Event();

        targetCollection.collectionChanged.addEventListener(ReferenceProperty.prototype._onCollectionChanged, this);
    };

    defineProperties(ReferenceProperty.prototype, {
        /**
         * Gets a value indicating if this property is constant.
         * @memberof ReferenceProperty.prototype
         * @type {Boolean}
         * @readonly
         */
        isConstant : {
            get : function() {
                return Property.isConstant(resolve(this));
            }
        },
        /**
         * Gets the event that is raised whenever the definition of this property changes.
         * The definition is changed whenever the referenced property's definition is changed.
         * @memberof ReferenceProperty.prototype
         * @type {Event}
         * @readonly
         */
        definitionChanged : {
            get : function() {
                return this._definitionChanged;
            }
        },
        /**
         * Gets the reference frame that the position is defined in.
         * This property is only valid if the referenced property is a {@link PositionProperty}.
         * @memberof ReferenceProperty.prototype
         * @Type {ReferenceFrame}
         * @readonly
         */
        referenceFrame : {
            get : function() {
                return resolve(this).referenceFrame;
            }
        },
        /**
         * Gets the id of the object being referenced.
         * @memberof ReferenceProperty.prototype
         * @Type {String}
         * @readonly
         */
        targetId : {
            get : function() {
                return this._targetId;
            }
        },
        /**
         * Gets the collection containing the object being referenced.
         * @memberof ReferenceProperty.prototype
         * @Type {DynamicObjectCollection}
         * @readonly
         */
        targetCollection : {
            get : function() {
                return this._targetCollection;
            }
        },
        /**
         * Gets the array of property names used to retrieve the referenced property.
         * @memberof ReferenceProperty.prototype
         * @Type {String[]}
         * @readonly
         */
        targetPropertyNames : {
            get : function() {
                return this._targetPropertyNames;
            }
        }
    });

    /**
     * Creates a new instance given the dynamic object collection that will
     * be used to resolve it and a string indicating the target object id and property.
     * The format of the string is "objectId#foo.bar", where # separates the id from
     * property path and . separates sub-properties.  If the reference identifier or
     * or any sub-properties contains a # . or \ they must be escaped.
     *
     * @param {DynamicObject} targetCollection
     * @param {String} referenceString
     * @returns A new instance of ReferenceProperty.
     *
     * @exception {DeveloperError} invalid referenceString.
     */
    ReferenceProperty.fromString = function(targetCollection, referenceString) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(targetCollection)) {
            throw new DeveloperError('targetCollection is required.');
        }
        if (!defined(referenceString)) {
            throw new DeveloperError('referenceString is required.');
        }
        //>>includeEnd('debug');

        var identifier;
        var values = [];

        var inIdentifier = true;
        var isEscaped = false;
        var token = '';
        for (var i = 0; i < referenceString.length; ++i) {
            var c = referenceString.charAt(i);

            if (isEscaped) {
                token += c;
                isEscaped = false;
            } else if (c === '\\') {
                isEscaped = true;
            } else if (inIdentifier && c === '#') {
                identifier = token;
                inIdentifier = false;
                token = '';
            } else if (!inIdentifier && c === '.') {
                values.push(token);
                token = '';
            } else {
                token += c;
            }
        }
        values.push(token);

        return new ReferenceProperty(targetCollection, identifier, values);
    };

    /**
     * Gets the value of the property at the provided time.
     *
     * @param {JulianDate} time The time for which to retrieve the value.
     * @param {Object} [result] The object to store the value into, if omitted, a new instance is created and returned.
     * @returns {Object} The modified result parameter or a new instance if the result parameter was not supplied.
     */
    ReferenceProperty.prototype.getValue = function(time, result) {
        return resolve(this).getValue(time, result);
    };

    /**
     * Gets the value of the property at the provided time and in the provided reference frame.
     * This method is only valid if the property being referenced is a {@link PositionProperty}.
     *
     * @param {JulianDate} time The time for which to retrieve the value.
     * @param {ReferenceFrame} referenceFrame The desired referenceFrame of the result.
     * @param {Cartesian3} [result] The object to store the value into, if omitted, a new instance is created and returned.
     * @returns {Cartesian3} The modified result parameter or a new instance if the result parameter was not supplied.
     */
    ReferenceProperty.prototype.getValueInReferenceFrame = function(time, referenceFrame, result) {
        return resolve(this).getValueInReferenceFrame(time, referenceFrame, result);
    };

    /**
     * Gets the {@link Material} type at the provided time.
     * This method is only valid if the property being referenced is a {@link MaterialProperty}.
     *
     * @param {JulianDate} time The time for which to retrieve the type.
     * @returns {String} The type of material.
     */
    ReferenceProperty.prototype.getType = function(time) {
        return resolve(this).getType(time);
    };

    /**
     * Compares this property to the provided property and returns
     * <code>true</code> if they are equal, <code>false</code> otherwise.
     *
     * @param {Property} [other] The other property.
     * @returns {Boolean} <code>true</code> if left and right are equal, <code>false</code> otherwise.
     */
    ReferenceProperty.prototype.equals = function(other) {
        if (this === other) {
            return true;
        }

        var names = this._targetPropertyNames;
        var otherNames = other._targetPropertyNames;

        if (this._targetCollection !== other._targetCollection || //
            this._targetId !== other._targetId || //
            names.length !== otherNames.length) {
            return false;
        }

        var length = this._targetPropertyNames.length;
        for (var i = 0; i < length; i++) {
            if (names[i] !== otherNames[i]) {
                return false;
            }
        }

        return true;
    };

    ReferenceProperty.prototype._onTargetObjectDefinitionChanged = function(targetObject, name, value, oldValue) {
        if (this._targetPropertyNames[0] === name) {
            this._targetProperty = undefined;
            this._definitionChanged.raiseEvent(this);
        }
    };

    ReferenceProperty.prototype._onCollectionChanged = function(collection, added, removed) {
        var targetObject = this._targetObject;
        if (defined(targetObject)) {
            if (removed.indexOf(targetObject) === -1) {
                targetObject.definitionChanged.removeEventListener(ReferenceProperty.prototype._onTargetObjectDefinitionChanged, this);
                this._targetProperty = undefined;
                this._targetObject = undefined;
                this._definitionChanged.raiseEvent(this);
            }
        }
    };

    return ReferenceProperty;
});
