(function () {
    function r(e, n, t) {
        function o(i, f) {
            if (!n[i]) {
                if (!e[i]) {
                    var c = "function" == typeof require && require;
                    if (!f && c) return c(i, !0);
                    if (u) return u(i, !0);
                    var a = new Error("Cannot find module '" + i + "'");
                    throw a.code = "MODULE_NOT_FOUND", a
                }
                var p = n[i] = {
                    exports: {}
                };
                e[i][0].call(p.exports, function (r) {
                    var n = e[i][1][r];
                    return o(n || r)
                }, p, p.exports, r, e, n, t)
            }
            return n[i].exports
        }
        for (var u = "function" == typeof require && require, i = 0; i < t.length; i++) o(t[i]);
        return o
    }
    return r
})()({
    1: [function (require, module, exports) {
        (function (global) {
            var ethJSABI = require("ethjs-abi");
            var BlockchainUtils = require("truffle-blockchain-utils");
            var Web3 = require("web3");
            var StatusError = require("./statuserror.js");
            if (typeof Web3 == "object" && Object.keys(Web3).length == 0) {
                Web3 = global.Web3
            }
            var contract = function (module) {
                function Provider(provider) {
                    this.provider = provider
                }
                Provider.prototype.send = function () {
                    return this.provider.send.apply(this.provider, arguments)
                };
                Provider.prototype.sendAsync = function () {
                    return this.provider.sendAsync.apply(this.provider, arguments)
                };
                var BigNumber = (new Web3).toBigNumber(0).constructor;
                var Utils = {
                    is_object: function (val) {
                        return typeof val == "object" && !Array.isArray(val)
                    },
                    is_big_number: function (val) {
                        if (typeof val != "object") return false;
                        try {
                            new BigNumber(val);
                            return true
                        } catch (e) {
                            return false
                        }
                    },
                    decodeLogs: function (C, instance, logs) {
                        return logs.map(function (log) {
                            var logABI = C.events[log.topics[0]];
                            if (logABI == null) {
                                return null
                            }
                            var copy = Utils.merge({}, log);

                            function partialABI(fullABI, indexed) {
                                var inputs = fullABI.inputs.filter(function (i) {
                                    return i.indexed === indexed
                                });
                                var partial = {
                                    inputs: inputs,
                                    name: fullABI.name,
                                    type: fullABI.type,
                                    anonymous: fullABI.anonymous
                                };
                                return partial
                            }
                            var argTopics = logABI.anonymous ? copy.topics : copy.topics.slice(1);
                            var indexedData = "0x" + argTopics.map(function (topics) {
                                return topics.slice(2)
                            }).join("");
                            var indexedParams = ethJSABI.decodeEvent(partialABI(logABI, true), indexedData);
                            var notIndexedData = copy.data;
                            var notIndexedParams = ethJSABI.decodeEvent(partialABI(logABI, false), notIndexedData);
                            copy.event = logABI.name;
                            copy.args = logABI.inputs.reduce(function (acc, current) {
                                var val = indexedParams[current.name];
                                if (val === undefined) {
                                    val = notIndexedParams[current.name]
                                }
                                acc[current.name] = val;
                                return acc
                            }, {});
                            Object.keys(copy.args).forEach(function (key) {
                                var val = copy.args[key];
                                if (val.constructor.isBN) {
                                    copy.args[key] = C.web3.toBigNumber("0x" + val.toString(16))
                                }
                            });
                            delete copy.data;
                            delete copy.topics;
                            return copy
                        }).filter(function (log) {
                            return log != null
                        })
                    },
                    promisifyFunction: function (fn, C) {
                        var self = this;
                        return function () {
                            var instance = this;
                            var args = Array.prototype.slice.call(arguments);
                            var tx_params = {};
                            var last_arg = args[args.length - 1];
                            if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
                                tx_params = args.pop()
                            }
                            tx_params = Utils.merge(C.class_defaults, tx_params);
                            return C.detectNetwork().then(function () {
                                return new Promise(function (accept, reject) {
                                    var callback = function (error, result) {
                                        if (error != null) {
                                            reject(error)
                                        } else {
                                            accept(result)
                                        }
                                    };
                                    args.push(tx_params, callback);
                                    fn.apply(instance.contract, args)
                                })
                            })
                        }
                    },
                    synchronizeFunction: function (fn, instance, C) {
                        var self = this;
                        return function () {
                            var args = Array.prototype.slice.call(arguments);
                            var tx_params = {};
                            var last_arg = args[args.length - 1];
                            if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
                                tx_params = args.pop()
                            }
                            tx_params = Utils.merge(C.class_defaults, tx_params);
                            return C.detectNetwork().then(function () {
                                return new Promise(function (accept, reject) {
                                    var callback = function (error, tx) {
                                        if (error != null) {
                                            reject(error);
                                            return
                                        }
                                        var timeout;
                                        if (C.synchronization_timeout === 0 || C.synchronization_timeout !== undefined) {
                                            timeout = C.synchronization_timeout
                                        } else {
                                            timeout = 24e4
                                        }
                                        var start = (new Date).getTime();
                                        var make_attempt = function () {
                                            C.web3.eth.getTransactionReceipt(tx, function (err, receipt) {
                                                if (err && !err.toString().includes("unknown transaction")) {
                                                    return reject(err)
                                                }
                                                if (receipt != null) {
                                                    if (parseInt(receipt.status, 16) == 0) {
                                                        var statusError = new StatusError(tx_params, tx, receipt);
                                                        return reject(statusError)
                                                    } else {
                                                        return accept({
                                                            tx: tx,
                                                            receipt: receipt,
                                                            logs: Utils.decodeLogs(C, instance, receipt.logs)
                                                        })
                                                    }
                                                }
                                                if (timeout > 0 && (new Date).getTime() - start > timeout) {
                                                    return reject(new Error("Transaction " + tx + " wasn't processed in " + timeout / 1e3 + " seconds!"))
                                                }
                                                setTimeout(make_attempt, 1e3)
                                            })
                                        };
                                        make_attempt()
                                    };
                                    args.push(tx_params, callback);
                                    fn.apply(self, args)
                                })
                            })
                        }
                    },
                    merge: function () {
                        var merged = {};
                        var args = Array.prototype.slice.call(arguments);
                        for (var i = 0; i < args.length; i++) {
                            var object = args[i];
                            var keys = Object.keys(object);
                            for (var j = 0; j < keys.length; j++) {
                                var key = keys[j];
                                var value = object[key];
                                merged[key] = value
                            }
                        }
                        return merged
                    },
                    parallel: function (arr, callback) {
                        callback = callback || function () {};
                        if (!arr.length) {
                            return callback(null, [])
                        }
                        var index = 0;
                        var results = new Array(arr.length);
                        arr.forEach(function (fn, position) {
                            fn(function (err, result) {
                                if (err) {
                                    callback(err);
                                    callback = function () {}
                                } else {
                                    index++;
                                    results[position] = result;
                                    if (index >= arr.length) {
                                        callback(null, results)
                                    }
                                }
                            })
                        })
                    },
                    bootstrap: function (fn) {
                        Object.keys(fn._static_methods).forEach(function (key) {
                            fn[key] = fn._static_methods[key].bind(fn)
                        });
                        Object.keys(fn._properties).forEach(function (key) {
                            fn.addProp(key, fn._properties[key])
                        });
                        return fn
                    },
                    linkBytecode: function (bytecode, links) {
                        Object.keys(links).forEach(function (library_name) {
                            var library_address = links[library_name];
                            var regex = new RegExp("__" + library_name + "_+", "g");
                            bytecode = bytecode.replace(regex, library_address.replace("0x", ""))
                        });
                        return bytecode
                    }
                };

                function Contract(contract) {
                    var self = this;
                    var constructor = this.constructor;
                    this.abi = constructor.abi;
                    if (typeof contract == "string") {
                        var address = contract;
                        var contract_class = constructor.web3.eth.contract(this.abi);
                        contract = contract_class.at(address)
                    }
                    this.contract = contract;
                    for (var i = 0; i < this.abi.length; i++) {
                        var item = this.abi[i];
                        if (item.type == "function") {
                            if (item.constant == true) {
                                this[item.name] = Utils.promisifyFunction(contract[item.name], constructor)
                            } else {
                                this[item.name] = Utils.synchronizeFunction(contract[item.name], this, constructor)
                            }
                            this[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
                            this[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
                            this[item.name].request = contract[item.name].request;
                            this[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor)
                        }
                        if (item.type == "event") {
                            this[item.name] = contract[item.name]
                        }
                    }
                    this.sendTransaction = Utils.synchronizeFunction(function (tx_params, callback) {
                        if (typeof tx_params == "function") {
                            callback = tx_params;
                            tx_params = {}
                        }
                        tx_params.to = self.address;
                        constructor.web3.eth.sendTransaction.apply(constructor.web3.eth, [tx_params, callback])
                    }, this, constructor);
                    this.send = function (value) {
                        return self.sendTransaction({
                            value: value
                        })
                    };
                    this.allEvents = contract.allEvents;
                    this.address = contract.address;
                    this.transactionHash = contract.transactionHash
                }
                Contract._static_methods = {
                    setProvider: function (provider) {
                        if (!provider) {
                            throw new Error("Invalid provider passed to setProvider(); provider is " + provider)
                        }
                        var wrapped = new Provider(provider);
                        this.web3.setProvider(wrapped);
                        this.currentProvider = provider
                    },
                    new: function () {
                        var self = this;
                        if (this.currentProvider == null) {
                            throw new Error(this.contractName + " error: Please call setProvider() first before calling new().")
                        }
                        var args = Array.prototype.slice.call(arguments);
                        if (!this.bytecode) {
                            throw new Error(this._json.contractName + " error: contract binary not set. Can't deploy new instance.")
                        }
                        return self.detectNetwork().then(function (network_id) {
                            var regex = /__[^_]+_+/g;
                            var unlinked_libraries = self.binary.match(regex);
                            if (unlinked_libraries != null) {
                                unlinked_libraries = unlinked_libraries.map(function (name) {
                                    return name.replace(/_/g, "")
                                }).sort().filter(function (name, index, arr) {
                                    if (index + 1 >= arr.length) {
                                        return true
                                    }
                                    return name != arr[index + 1]
                                }).join(", ");
                                throw new Error(self.contractName + " contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of " + self._json.contractName + ": " + unlinked_libraries)
                            }
                        }).then(function () {
                            return new Promise(function (accept, reject) {
                                var contract_class = self.web3.eth.contract(self.abi);
                                var tx_params = {};
                                var last_arg = args[args.length - 1];
                                if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
                                    tx_params = args.pop()
                                }
                                var constructor = self.abi.filter(function (item) {
                                    return item.type === "constructor"
                                });
                                if (constructor.length && constructor[0].inputs.length !== args.length) {
                                    throw new Error(self.contractName + " contract constructor expected " + constructor[0].inputs.length + " arguments, received " + args.length)
                                }
                                tx_params = Utils.merge(self.class_defaults, tx_params);
                                if (tx_params.data == null) {
                                    tx_params.data = self.binary
                                }
                                var intermediary = function (err, web3_instance) {
                                    if (err != null) {
                                        reject(err);
                                        return
                                    }
                                    if (err == null && web3_instance != null && web3_instance.address != null) {
                                        accept(new self(web3_instance))
                                    }
                                };
                                args.push(tx_params, intermediary);
                                contract_class.new.apply(contract_class, args)
                            })
                        })
                    },
                    at: function (address) {
                        var self = this;
                        if (address == null || typeof address != "string" || address.length != 42) {
                            throw new Error("Invalid address passed to " + this._json.contractName + ".at(): " + address)
                        }
                        var contract = new this(address);
                        contract.then = function (fn) {
                            return self.detectNetwork().then(function (network_id) {
                                var instance = new self(address);
                                return new Promise(function (accept, reject) {
                                    self.web3.eth.getCode(address, function (err, code) {
                                        if (err) return reject(err);
                                        if (!code || code.replace("0x", "").replace(/0/g, "") === "") {
                                            return reject(new Error("Cannot create instance of " + self.contractName + "; no code at address " + address))
                                        }
                                        accept(instance)
                                    })
                                })
                            }).then(fn)
                        };
                        return contract
                    },
                    deployed: function () {
                        var self = this;
                        return self.detectNetwork().then(function () {
                            if (self._json.networks[self.network_id] == null) {
                                throw new Error(self.contractName + " has not been deployed to detected network (network/artifact mismatch)")
                            }
                            if (!self.isDeployed()) {
                                throw new Error(self.contractName + " has not been deployed to detected network (" + self.network_id + ")")
                            }
                            return new self(self.address)
                        })
                    },
                    defaults: function (class_defaults) {
                        if (this.class_defaults == null) {
                            this.class_defaults = {}
                        }
                        if (class_defaults == null) {
                            class_defaults = {}
                        }
                        var self = this;
                        Object.keys(class_defaults).forEach(function (key) {
                            var value = class_defaults[key];
                            self.class_defaults[key] = value
                        });
                        return this.class_defaults
                    },
                    hasNetwork: function (network_id) {
                        return this._json.networks[network_id + ""] != null
                    },
                    isDeployed: function () {
                        if (this.network_id == null) {
                            return false
                        }
                        if (this._json.networks[this.network_id] == null) {
                            return false
                        }
                        return !!this.network.address
                    },
                    detectNetwork: function () {
                        var self = this;
                        return new Promise(function (accept, reject) {
                            if (self.network_id) {
                                if (self.networks[self.network_id] != null) {
                                    return accept(self.network_id)
                                }
                            }
                            self.web3.version.getNetwork(function (err, result) {
                                if (err) return reject(err);
                                var network_id = result.toString();
                                if (self.hasNetwork(network_id)) {
                                    self.setNetwork(network_id);
                                    return accept()
                                }
                                var uris = Object.keys(self._json.networks).filter(function (network) {
                                    return network.indexOf("blockchain://") == 0
                                });
                                var matches = uris.map(function (uri) {
                                    return BlockchainUtils.matches.bind(BlockchainUtils, uri, self.web3.currentProvider)
                                });
                                Utils.parallel(matches, function (err, results) {
                                    if (err) return reject(err);
                                    for (var i = 0; i < results.length; i++) {
                                        if (results[i]) {
                                            self.setNetwork(uris[i]);
                                            return accept()
                                        }
                                    }
                                    self.setNetwork(network_id);
                                    accept()
                                })
                            })
                        })
                    },
                    setNetwork: function (network_id) {
                        if (!network_id) return;
                        this.network_id = network_id + ""
                    },
                    resetAddress: function () {
                        delete this.network.address
                    },
                    link: function (name, address) {
                        var self = this;
                        if (typeof name == "function") {
                            var contract = name;
                            if (contract.isDeployed() == false) {
                                throw new Error("Cannot link contract without an address.")
                            }
                            this.link(contract.contractName, contract.address);
                            Object.keys(contract.events).forEach(function (topic) {
                                self.network.events[topic] = contract.events[topic]
                            });
                            return
                        }
                        if (typeof name == "object") {
                            var obj = name;
                            Object.keys(obj).forEach(function (name) {
                                var a = obj[name];
                                self.link(name, a)
                            });
                            return
                        }
                        if (this._json.networks[this.network_id] == null) {
                            this._json.networks[this.network_id] = {
                                events: {},
                                links: {}
                            }
                        }
                        this.network.links[name] = address
                    },
                    clone: function (json) {
                        var self = this;
                        json = json || {};
                        var temp = function TruffleContract() {
                            this.constructor = temp;
                            return Contract.apply(this, arguments)
                        };
                        temp.prototype = Object.create(self.prototype);
                        var network_id;
                        if (typeof json != "object") {
                            network_id = json;
                            json = self._json
                        }
                        json = Utils.merge({}, self._json || {}, json);
                        temp._static_methods = this._static_methods;
                        temp._properties = this._properties;
                        temp._property_values = {};
                        temp._json = json;
                        Utils.bootstrap(temp);
                        temp.web3 = new Web3;
                        temp.class_defaults = temp.prototype.defaults || {};
                        if (network_id) {
                            temp.setNetwork(network_id)
                        }
                        Object.keys(json).forEach(function (key) {
                            if (key.indexOf("x-") != 0) return;
                            temp[key] = json[key]
                        });
                        return temp
                    },
                    addProp: function (key, fn) {
                        var self = this;
                        var getter = function () {
                            if (fn.get != null) {
                                return fn.get.call(self)
                            }
                            return self._property_values[key] || fn.call(self)
                        };
                        var setter = function (val) {
                            if (fn.set != null) {
                                fn.set.call(self, val);
                                return
                            }
                            throw new Error(key + " property is immutable")
                        };
                        var definition = {};
                        definition.enumerable = false;
                        definition.configurable = false;
                        definition.get = getter;
                        definition.set = setter;
                        Object.defineProperty(this, key, definition)
                    },
                    toJSON: function () {
                        return this._json
                    }
                };
                Contract._properties = {
                    contract_name: {
                        get: function () {
                            return this.contractName
                        },
                        set: function (val) {
                            this.contractName = val
                        }
                    },
                    contractName: {
                        get: function () {
                            return this._json.contractName || "Contract"
                        },
                        set: function (val) {
                            this._json.contractName = val
                        }
                    },
                    abi: {
                        get: function () {
                            return this._json.abi
                        },
                        set: function (val) {
                            this._json.abi = val
                        }
                    },
                    network: function () {
                        var network_id = this.network_id;
                        if (network_id == null) {
                            throw new Error(this.contractName + " has no network id set, cannot lookup artifact data. Either set the network manually using " + this.contractName + ".setNetwork(), run " + this.contractName + ".detectNetwork(), or use new(), at() or deployed() as a thenable which will detect the network automatically.")
                        }
                        if (this._json.networks[network_id] == null) {
                            throw new Error(this.contractName + " has no network configuration for its current network id (" + network_id + ").")
                        }
                        var returnVal = this._json.networks[network_id];
                        if (returnVal.links == null) {
                            returnVal.links = {}
                        }
                        if (returnVal.events == null) {
                            returnVal.events = {}
                        }
                        return returnVal
                    },
                    networks: function () {
                        return this._json.networks
                    },
                    address: {
                        get: function () {
                            var address = this.network.address;
                            if (address == null) {
                                throw new Error("Cannot find deployed address: " + this.contractName + " not deployed or address not set.")
                            }
                            return address
                        },
                        set: function (val) {
                            if (val == null) {
                                throw new Error("Cannot set deployed address; malformed value: " + val)
                            }
                            var network_id = this.network_id;
                            if (network_id == null) {
                                throw new Error(this.contractName + " has no network id set, cannot lookup artifact data. Either set the network manually using " + this.contractName + ".setNetwork(), run " + this.contractName + ".detectNetwork(), or use new(), at() or deployed() as a thenable which will detect the network automatically.")
                            }
                            if (this._json.networks[network_id] == null) {
                                this._json.networks[network_id] = {
                                    events: {},
                                    links: {}
                                }
                            }
                            this.network.address = val
                        }
                    },
                    transactionHash: {
                        get: function () {
                            var transactionHash = this.network.transactionHash;
                            if (transactionHash === null) {
                                throw new Error("Could not find transaction hash for " + this.contractName)
                            }
                            return transactionHash
                        },
                        set: function (val) {
                            this.network.transactionHash = val
                        }
                    },
                    links: function () {
                        if (!this.network_id) {
                            throw new Error(this.contractName + " has no network id set, cannot lookup artifact data. Either set the network manually using " + this.contractName + ".setNetwork(), run " + this.contractName + ".detectNetwork(), or use new(), at() or deployed() as a thenable which will detect the network automatically.")
                        }
                        if (this._json.networks[this.network_id] == null) {
                            return {}
                        }
                        return this.network.links || {}
                    },
                    events: function () {
                        var web3 = new Web3;
                        var events;
                        if (this._json.networks[this.network_id] == null) {
                            events = {}
                        } else {
                            events = this.network.events || {}
                        }
                        var abi = this.abi;
                        abi.forEach(function (item) {
                            if (item.type != "event") return;
                            var signature = item.name + "(";
                            item.inputs.forEach(function (input, index) {
                                signature += input.type;
                                if (index < item.inputs.length - 1) {
                                    signature += ","
                                }
                            });
                            signature += ")";
                            var topic = web3.sha3(signature);
                            events[topic] = item
                        });
                        return events
                    },
                    binary: function () {
                        return Utils.linkBytecode(this.bytecode, this.links)
                    },
                    deployedBinary: function () {
                        return Utils.linkBytecode(this.deployedBytecode, this.links)
                    },
                    unlinked_binary: {
                        get: function () {
                            return this.bytecode
                        },
                        set: function (val) {
                            this.bytecode = val
                        }
                    },
                    bytecode: {
                        get: function () {
                            return this._json.bytecode
                        },
                        set: function (val) {
                            this._json.bytecode = val
                        }
                    },
                    deployedBytecode: {
                        get: function () {
                            var code = this._json.deployedBytecode;
                            if (code.indexOf("0x") != 0) {
                                code = "0x" + code
                            }
                            return code
                        },
                        set: function (val) {
                            var code = val;
                            if (val.indexOf("0x") != 0) {
                                code = "0x" + code
                            }
                            this._json.deployedBytecode = code
                        }
                    },
                    sourceMap: {
                        get: function () {
                            return this._json.sourceMap
                        },
                        set: function (val) {
                            this._json.sourceMap = val
                        }
                    },
                    deployedSourceMap: {
                        get: function () {
                            return this._json.deployedSourceMap
                        },
                        set: function (val) {
                            this._json.deployedSourceMap = val
                        }
                    },
                    source: {
                        get: function () {
                            return this._json.source
                        },
                        set: function (val) {
                            this._json.source = val
                        }
                    },
                    sourcePath: {
                        get: function () {
                            return this._json.sourcePath
                        },
                        set: function (val) {
                            this._json.sourcePath = val
                        }
                    },
                    legacyAST: {
                        get: function () {
                            return this._json.legacyAST
                        },
                        set: function (val) {
                            this._json.legacyAST = val
                        }
                    },
                    ast: {
                        get: function () {
                            return this._json.ast
                        },
                        set: function (val) {
                            this._json.ast = val
                        }
                    },
                    compiler: {
                        get: function () {
                            return this._json.compiler
                        },
                        set: function (val) {
                            this._json.compiler = val
                        }
                    },
                    schema_version: function () {
                        return this.schemaVersion
                    },
                    schemaVersion: function () {
                        return this._json.schemaVersion
                    },
                    updated_at: function () {
                        return this.updatedAt
                    },
                    updatedAt: function () {
                        try {
                            return this.network.updatedAt || this._json.updatedAt
                        } catch (e) {
                            return this._json.updatedAt
                        }
                    }
                };
                Utils.bootstrap(Contract);
                module.exports = Contract;
                return Contract
            }(module || {})
        }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
    }, {
        "./statuserror.js": 79,
        "ethjs-abi": 51,
        "truffle-blockchain-utils": 66,
        web3: 45
    }],
    2: [function (require, module, exports) {
        var Schema = require("truffle-contract-schema");
        var Contract = require("./contract.js");
        var contract = function (options) {
            var binary = Schema.normalize(options || {});
            return Contract.clone(binary)
        };
        module.exports = contract;
        if (typeof window !== "undefined") {
            window.TruffleContract = contract
        }
    }, {
        "./contract.js": 1,
        "truffle-contract-schema": 67
    }],
    3: [function (require, module, exports) {
        "use strict";
        var KEYWORDS = ["multipleOf", "maximum", "exclusiveMaximum", "minimum", "exclusiveMinimum", "maxLength", "minLength", "pattern", "additionalItems", "maxItems", "minItems", "uniqueItems", "maxProperties", "minProperties", "required", "additionalProperties", "enum", "format", "const"];
        module.exports = function (metaSchema, keywordsJsonPointers) {
            for (var i = 0; i < keywordsJsonPointers.length; i++) {
                metaSchema = JSON.parse(JSON.stringify(metaSchema));
                var segments = keywordsJsonPointers[i].split("/");
                var keywords = metaSchema;
                var j;
                for (j = 1; j < segments.length; j++) keywords = keywords[segments[j]];
                for (j = 0; j < KEYWORDS.length; j++) {
                    var key = KEYWORDS[j];
                    var schema = keywords[key];
                    if (schema) {
                        keywords[key] = {
                            anyOf: [schema, {
                                $ref: "https://raw.githubusercontent.com/epoberezkin/ajv/master/lib/refs/$data.json#"
                            }]
                        }
                    }
                }
            }
            return metaSchema
        }
    }, {}],
    4: [function (require, module, exports) {
        "use strict";
        var compileSchema = require("./compile"),
            resolve = require("./compile/resolve"),
            Cache = require("./cache"),
            SchemaObject = require("./compile/schema_obj"),
            stableStringify = require("fast-json-stable-stringify"),
            formats = require("./compile/formats"),
            rules = require("./compile/rules"),
            $dataMetaSchema = require("./$data"),
            patternGroups = require("./patternGroups"),
            util = require("./compile/util"),
            co = require("co");
        module.exports = Ajv;
        Ajv.prototype.validate = validate;
        Ajv.prototype.compile = compile;
        Ajv.prototype.addSchema = addSchema;
        Ajv.prototype.addMetaSchema = addMetaSchema;
        Ajv.prototype.validateSchema = validateSchema;
        Ajv.prototype.getSchema = getSchema;
        Ajv.prototype.removeSchema = removeSchema;
        Ajv.prototype.addFormat = addFormat;
        Ajv.prototype.errorsText = errorsText;
        Ajv.prototype._addSchema = _addSchema;
        Ajv.prototype._compile = _compile;
        Ajv.prototype.compileAsync = require("./compile/async");
        var customKeyword = require("./keyword");
        Ajv.prototype.addKeyword = customKeyword.add;
        Ajv.prototype.getKeyword = customKeyword.get;
        Ajv.prototype.removeKeyword = customKeyword.remove;
        var errorClasses = require("./compile/error_classes");
        Ajv.ValidationError = errorClasses.Validation;
        Ajv.MissingRefError = errorClasses.MissingRef;
        Ajv.$dataMetaSchema = $dataMetaSchema;
        var META_SCHEMA_ID = "http://json-schema.org/draft-06/schema";
        var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
        var META_SUPPORT_DATA = ["/properties"];

        function Ajv(opts) {
            if (!(this instanceof Ajv)) return new Ajv(opts);
            opts = this._opts = util.copy(opts) || {};
            setLogger(this);
            this._schemas = {};
            this._refs = {};
            this._fragments = {};
            this._formats = formats(opts.format);
            var schemaUriFormat = this._schemaUriFormat = this._formats["uri-reference"];
            this._schemaUriFormatFunc = function (str) {
                return schemaUriFormat.test(str)
            };
            this._cache = opts.cache || new Cache;
            this._loadingSchemas = {};
            this._compilations = [];
            this.RULES = rules();
            this._getId = chooseGetId(opts);
            opts.loopRequired = opts.loopRequired || Infinity;
            if (opts.errorDataPath == "property") opts._errorDataPathProperty = true;
            if (opts.serialize === undefined) opts.serialize = stableStringify;
            this._metaOpts = getMetaSchemaOptions(this);
            if (opts.formats) addInitialFormats(this);
            addDraft6MetaSchema(this);
            if (typeof opts.meta == "object") this.addMetaSchema(opts.meta);
            addInitialSchemas(this);
            if (opts.patternGroups) patternGroups(this)
        }

        function validate(schemaKeyRef, data) {
            var v;
            if (typeof schemaKeyRef == "string") {
                v = this.getSchema(schemaKeyRef);
                if (!v) throw new Error('no schema with key or ref "' + schemaKeyRef + '"')
            } else {
                var schemaObj = this._addSchema(schemaKeyRef);
                v = schemaObj.validate || this._compile(schemaObj)
            }
            var valid = v(data);
            if (v.$async === true) return this._opts.async == "*" ? co(valid) : valid;
            this.errors = v.errors;
            return valid
        }

        function compile(schema, _meta) {
            var schemaObj = this._addSchema(schema, undefined, _meta);
            return schemaObj.validate || this._compile(schemaObj)
        }

        function addSchema(schema, key, _skipValidation, _meta) {
            if (Array.isArray(schema)) {
                for (var i = 0; i < schema.length; i++) this.addSchema(schema[i], undefined, _skipValidation, _meta);
                return this
            }
            var id = this._getId(schema);
            if (id !== undefined && typeof id != "string") throw new Error("schema id must be string");
            key = resolve.normalizeId(key || id);
            checkUnique(this, key);
            this._schemas[key] = this._addSchema(schema, _skipValidation, _meta, true);
            return this
        }

        function addMetaSchema(schema, key, skipValidation) {
            this.addSchema(schema, key, skipValidation, true);
            return this
        }

        function validateSchema(schema, throwOrLogError) {
            var $schema = schema.$schema;
            if ($schema !== undefined && typeof $schema != "string") throw new Error("$schema must be a string");
            $schema = $schema || this._opts.defaultMeta || defaultMeta(this);
            if (!$schema) {
                this.logger.warn("meta-schema not available");
                this.errors = null;
                return true
            }
            var currentUriFormat = this._formats.uri;
            this._formats.uri = typeof currentUriFormat == "function" ? this._schemaUriFormatFunc : this._schemaUriFormat;
            var valid;
            try {
                valid = this.validate($schema, schema)
            } finally {
                this._formats.uri = currentUriFormat
            }
            if (!valid && throwOrLogError) {
                var message = "schema is invalid: " + this.errorsText();
                if (this._opts.validateSchema == "log") this.logger.error(message);
                else throw new Error(message)
            }
            return valid
        }

        function defaultMeta(self) {
            var meta = self._opts.meta;
            self._opts.defaultMeta = typeof meta == "object" ? self._getId(meta) || meta : self.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined;
            return self._opts.defaultMeta
        }

        function getSchema(keyRef) {
            var schemaObj = _getSchemaObj(this, keyRef);
            switch (typeof schemaObj) {
                case "object":
                    return schemaObj.validate || this._compile(schemaObj);
                case "string":
                    return this.getSchema(schemaObj);
                case "undefined":
                    return _getSchemaFragment(this, keyRef)
            }
        }

        function _getSchemaFragment(self, ref) {
            var res = resolve.schema.call(self, {
                schema: {}
            }, ref);
            if (res) {
                var schema = res.schema,
                    root = res.root,
                    baseId = res.baseId;
                var v = compileSchema.call(self, schema, root, undefined, baseId);
                self._fragments[ref] = new SchemaObject({
                    ref: ref,
                    fragment: true,
                    schema: schema,
                    root: root,
                    baseId: baseId,
                    validate: v
                });
                return v
            }
        }

        function _getSchemaObj(self, keyRef) {
            keyRef = resolve.normalizeId(keyRef);
            return self._schemas[keyRef] || self._refs[keyRef] || self._fragments[keyRef]
        }

        function removeSchema(schemaKeyRef) {
            if (schemaKeyRef instanceof RegExp) {
                _removeAllSchemas(this, this._schemas, schemaKeyRef);
                _removeAllSchemas(this, this._refs, schemaKeyRef);
                return this
            }
            switch (typeof schemaKeyRef) {
                case "undefined":
                    _removeAllSchemas(this, this._schemas);
                    _removeAllSchemas(this, this._refs);
                    this._cache.clear();
                    return this;
                case "string":
                    var schemaObj = _getSchemaObj(this, schemaKeyRef);
                    if (schemaObj) this._cache.del(schemaObj.cacheKey);
                    delete this._schemas[schemaKeyRef];
                    delete this._refs[schemaKeyRef];
                    return this;
                case "object":
                    var serialize = this._opts.serialize;
                    var cacheKey = serialize ? serialize(schemaKeyRef) : schemaKeyRef;
                    this._cache.del(cacheKey);
                    var id = this._getId(schemaKeyRef);
                    if (id) {
                        id = resolve.normalizeId(id);
                        delete this._schemas[id];
                        delete this._refs[id]
                    }
            }
            return this
        }

        function _removeAllSchemas(self, schemas, regex) {
            for (var keyRef in schemas) {
                var schemaObj = schemas[keyRef];
                if (!schemaObj.meta && (!regex || regex.test(keyRef))) {
                    self._cache.del(schemaObj.cacheKey);
                    delete schemas[keyRef]
                }
            }
        }

        function _addSchema(schema, skipValidation, meta, shouldAddSchema) {
            if (typeof schema != "object" && typeof schema != "boolean") throw new Error("schema should be object or boolean");
            var serialize = this._opts.serialize;
            var cacheKey = serialize ? serialize(schema) : schema;
            var cached = this._cache.get(cacheKey);
            if (cached) return cached;
            shouldAddSchema = shouldAddSchema || this._opts.addUsedSchema !== false;
            var id = resolve.normalizeId(this._getId(schema));
            if (id && shouldAddSchema) checkUnique(this, id);
            var willValidate = this._opts.validateSchema !== false && !skipValidation;
            var recursiveMeta;
            if (willValidate && !(recursiveMeta = id && id == resolve.normalizeId(schema.$schema))) this.validateSchema(schema, true);
            var localRefs = resolve.ids.call(this, schema);
            var schemaObj = new SchemaObject({
                id: id,
                schema: schema,
                localRefs: localRefs,
                cacheKey: cacheKey,
                meta: meta
            });
            if (id[0] != "#" && shouldAddSchema) this._refs[id] = schemaObj;
            this._cache.put(cacheKey, schemaObj);
            if (willValidate && recursiveMeta) this.validateSchema(schema, true);
            return schemaObj
        }

        function _compile(schemaObj, root) {
            if (schemaObj.compiling) {
                schemaObj.validate = callValidate;
                callValidate.schema = schemaObj.schema;
                callValidate.errors = null;
                callValidate.root = root ? root : callValidate;
                if (schemaObj.schema.$async === true) callValidate.$async = true;
                return callValidate
            }
            schemaObj.compiling = true;
            var currentOpts;
            if (schemaObj.meta) {
                currentOpts = this._opts;
                this._opts = this._metaOpts
            }
            var v;
            try {
                v = compileSchema.call(this, schemaObj.schema, root, schemaObj.localRefs)
            } finally {
                schemaObj.compiling = false;
                if (schemaObj.meta) this._opts = currentOpts
            }
            schemaObj.validate = v;
            schemaObj.refs = v.refs;
            schemaObj.refVal = v.refVal;
            schemaObj.root = v.root;
            return v;

            function callValidate() {
                var _validate = schemaObj.validate;
                var result = _validate.apply(null, arguments);
                callValidate.errors = _validate.errors;
                return result
            }
        }

        function chooseGetId(opts) {
            switch (opts.schemaId) {
                case "$id":
                    return _get$Id;
                case "id":
                    return _getId;
                default:
                    return _get$IdOrId
            }
        }

        function _getId(schema) {
            if (schema.$id) this.logger.warn("schema $id ignored", schema.$id);
            return schema.id
        }

        function _get$Id(schema) {
            if (schema.id) this.logger.warn("schema id ignored", schema.id);
            return schema.$id
        }

        function _get$IdOrId(schema) {
            if (schema.$id && schema.id && schema.$id != schema.id) throw new Error("schema $id is different from id");
            return schema.$id || schema.id
        }

        function errorsText(errors, options) {
            errors = errors || this.errors;
            if (!errors) return "No errors";
            options = options || {};
            var separator = options.separator === undefined ? ", " : options.separator;
            var dataVar = options.dataVar === undefined ? "data" : options.dataVar;
            var text = "";
            for (var i = 0; i < errors.length; i++) {
                var e = errors[i];
                if (e) text += dataVar + e.dataPath + " " + e.message + separator
            }
            return text.slice(0, -separator.length)
        }

        function addFormat(name, format) {
            if (typeof format == "string") format = new RegExp(format);
            this._formats[name] = format;
            return this
        }

        function addDraft6MetaSchema(self) {
            var $dataSchema;
            if (self._opts.$data) {
                $dataSchema = require("./refs/$data.json");
                self.addMetaSchema($dataSchema, $dataSchema.$id, true)
            }
            if (self._opts.meta === false) return;
            var metaSchema = require("./refs/json-schema-draft-06.json");
            if (self._opts.$data) metaSchema = $dataMetaSchema(metaSchema, META_SUPPORT_DATA);
            self.addMetaSchema(metaSchema, META_SCHEMA_ID, true);
            self._refs["http://json-schema.org/schema"] = META_SCHEMA_ID
        }

        function addInitialSchemas(self) {
            var optsSchemas = self._opts.schemas;
            if (!optsSchemas) return;
            if (Array.isArray(optsSchemas)) self.addSchema(optsSchemas);
            else
                for (var key in optsSchemas) self.addSchema(optsSchemas[key], key)
        }

        function addInitialFormats(self) {
            for (var name in self._opts.formats) {
                var format = self._opts.formats[name];
                self.addFormat(name, format)
            }
        }

        function checkUnique(self, id) {
            if (self._schemas[id] || self._refs[id]) throw new Error('schema with key or id "' + id + '" already exists')
        }

        function getMetaSchemaOptions(self) {
            var metaOpts = util.copy(self._opts);
            for (var i = 0; i < META_IGNORE_OPTIONS.length; i++) delete metaOpts[META_IGNORE_OPTIONS[i]];
            return metaOpts
        }

        function setLogger(self) {
            var logger = self._opts.logger;
            if (logger === false) {
                self.logger = {
                    log: noop,
                    warn: noop,
                    error: noop
                }
            } else {
                if (logger === undefined) logger = console;
                if (!(typeof logger == "object" && logger.log && logger.warn && logger.error)) throw new Error("logger must implement log, warn and error methods");
                self.logger = logger
            }
        }

        function noop() {}
    }, {
        "./$data": 3,
        "./cache": 5,
        "./compile": 10,
        "./compile/async": 7,
        "./compile/error_classes": 8,
        "./compile/formats": 9,
        "./compile/resolve": 11,
        "./compile/rules": 12,
        "./compile/schema_obj": 13,
        "./compile/util": 15,
        "./keyword": 39,
        "./patternGroups": 40,
        "./refs/$data.json": 41,
        "./refs/json-schema-draft-06.json": 42,
        co: 47,
        "fast-json-stable-stringify": 54
    }],
    5: [function (require, module, exports) {
        "use strict";
        var Cache = module.exports = function Cache() {
            this._cache = {}
        };
        Cache.prototype.put = function Cache_put(key, value) {
            this._cache[key] = value
        };
        Cache.prototype.get = function Cache_get(key) {
            return this._cache[key]
        };
        Cache.prototype.del = function Cache_del(key) {
            delete this._cache[key]
        };
        Cache.prototype.clear = function Cache_clear() {
            this._cache = {}
        }
    }, {}],
    6: [function (require, module, exports) {
        "use strict";
        module.exports = {
            $ref: require("../dotjs/ref"),
            allOf: require("../dotjs/allOf"),
            anyOf: require("../dotjs/anyOf"),
            const: require("../dotjs/const"),
            contains: require("../dotjs/contains"),
            dependencies: require("../dotjs/dependencies"),
            enum: require("../dotjs/enum"),
            format: require("../dotjs/format"),
            items: require("../dotjs/items"),
            maximum: require("../dotjs/_limit"),
            minimum: require("../dotjs/_limit"),
            maxItems: require("../dotjs/_limitItems"),
            minItems: require("../dotjs/_limitItems"),
            maxLength: require("../dotjs/_limitLength"),
            minLength: require("../dotjs/_limitLength"),
            maxProperties: require("../dotjs/_limitProperties"),
            minProperties: require("../dotjs/_limitProperties"),
            multipleOf: require("../dotjs/multipleOf"),
            not: require("../dotjs/not"),
            oneOf: require("../dotjs/oneOf"),
            pattern: require("../dotjs/pattern"),
            properties: require("../dotjs/properties"),
            propertyNames: require("../dotjs/propertyNames"),
            required: require("../dotjs/required"),
            uniqueItems: require("../dotjs/uniqueItems"),
            validate: require("../dotjs/validate")
        }
    }, {
        "../dotjs/_limit": 16,
        "../dotjs/_limitItems": 17,
        "../dotjs/_limitLength": 18,
        "../dotjs/_limitProperties": 19,
        "../dotjs/allOf": 20,
        "../dotjs/anyOf": 21,
        "../dotjs/const": 22,
        "../dotjs/contains": 23,
        "../dotjs/dependencies": 25,
        "../dotjs/enum": 26,
        "../dotjs/format": 27,
        "../dotjs/items": 28,
        "../dotjs/multipleOf": 29,
        "../dotjs/not": 30,
        "../dotjs/oneOf": 31,
        "../dotjs/pattern": 32,
        "../dotjs/properties": 33,
        "../dotjs/propertyNames": 34,
        "../dotjs/ref": 35,
        "../dotjs/required": 36,
        "../dotjs/uniqueItems": 37,
        "../dotjs/validate": 38
    }],
    7: [function (require, module, exports) {
        "use strict";
        var MissingRefError = require("./error_classes").MissingRef;
        module.exports = compileAsync;

        function compileAsync(schema, meta, callback) {
            var self = this;
            if (typeof this._opts.loadSchema != "function") throw new Error("options.loadSchema should be a function");
            if (typeof meta == "function") {
                callback = meta;
                meta = undefined
            }
            var p = loadMetaSchemaOf(schema).then(function () {
                var schemaObj = self._addSchema(schema, undefined, meta);
                return schemaObj.validate || _compileAsync(schemaObj)
            });
            if (callback) {
                p.then(function (v) {
                    callback(null, v)
                }, callback)
            }
            return p;

            function loadMetaSchemaOf(sch) {
                var $schema = sch.$schema;
                return $schema && !self.getSchema($schema) ? compileAsync.call(self, {
                    $ref: $schema
                }, true) : Promise.resolve()
            }

            function _compileAsync(schemaObj) {
                try {
                    return self._compile(schemaObj)
                } catch (e) {
                    if (e instanceof MissingRefError) return loadMissingSchema(e);
                    throw e
                }

                function loadMissingSchema(e) {
                    var ref = e.missingSchema;
                    if (added(ref)) throw new Error("Schema " + ref + " is loaded but " + e.missingRef + " cannot be resolved");
                    var schemaPromise = self._loadingSchemas[ref];
                    if (!schemaPromise) {
                        schemaPromise = self._loadingSchemas[ref] = self._opts.loadSchema(ref);
                        schemaPromise.then(removePromise, removePromise)
                    }
                    return schemaPromise.then(function (sch) {
                        if (!added(ref)) {
                            return loadMetaSchemaOf(sch).then(function () {
                                if (!added(ref)) self.addSchema(sch, ref, undefined, meta)
                            })
                        }
                    }).then(function () {
                        return _compileAsync(schemaObj)
                    });

                    function removePromise() {
                        delete self._loadingSchemas[ref]
                    }

                    function added(ref) {
                        return self._refs[ref] || self._schemas[ref]
                    }
                }
            }
        }
    }, {
        "./error_classes": 8
    }],
    8: [function (require, module, exports) {
        "use strict";
        var resolve = require("./resolve");
        module.exports = {
            Validation: errorSubclass(ValidationError),
            MissingRef: errorSubclass(MissingRefError)
        };

        function ValidationError(errors) {
            this.message = "validation failed";
            this.errors = errors;
            this.ajv = this.validation = true
        }
        MissingRefError.message = function (baseId, ref) {
            return "can't resolve reference " + ref + " from id " + baseId
        };

        function MissingRefError(baseId, ref, message) {
            this.message = message || MissingRefError.message(baseId, ref);
            this.missingRef = resolve.url(baseId, ref);
            this.missingSchema = resolve.normalizeId(resolve.fullPath(this.missingRef))
        }

        function errorSubclass(Subclass) {
            Subclass.prototype = Object.create(Error.prototype);
            Subclass.prototype.constructor = Subclass;
            return Subclass
        }
    }, {
        "./resolve": 11
    }],
    9: [function (require, module, exports) {
        "use strict";
        var util = require("./util");
        var DATE = /^\d\d\d\d-(\d\d)-(\d\d)$/;
        var DAYS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        var TIME = /^(\d\d):(\d\d):(\d\d)(\.\d+)?(z|[+-]\d\d:\d\d)?$/i;
        var HOSTNAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*$/i;
        var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@\/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@\/?]|%[0-9a-f]{2})*)?$/i;
        var URIREF = /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@\/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@\/?]|%[0-9a-f]{2})*)?$/i;
        var URITEMPLATE = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#.\/;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
        var URL = /^(?:(?:http[s\u017F]?|ftp):\/\/)(?:(?:[\0-\x08\x0E-\x1F!-\x9F\xA1-\u167F\u1681-\u1FFF\u200B-\u2027\u202A-\u202E\u2030-\u205E\u2060-\u2FFF\u3001-\uD7FF\uE000-\uFEFE\uFF00-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])+(?::(?:[\0-\x08\x0E-\x1F!-\x9F\xA1-\u167F\u1681-\u1FFF\u200B-\u2027\u202A-\u202E\u2030-\u205E\u2060-\u2FFF\u3001-\uD7FF\uE000-\uFEFE\uFF00-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])*)?@)?(?:(?!10(?:\.[0-9]{1,3}){3})(?!127(?:\.[0-9]{1,3}){3})(?!169\.254(?:\.[0-9]{1,3}){2})(?!192\.168(?:\.[0-9]{1,3}){2})(?!172\.(?:1[6-9]|2[0-9]|3[01])(?:\.[0-9]{1,3}){2})(?:[1-9][0-9]?|1[0-9][0-9]|2[01][0-9]|22[0-3])(?:\.(?:1?[0-9]{1,2}|2[0-4][0-9]|25[0-5])){2}(?:\.(?:[1-9][0-9]?|1[0-9][0-9]|2[0-4][0-9]|25[0-4]))|(?:(?:(?:[0-9KSa-z\xA1-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])+-?)*(?:[0-9KSa-z\xA1-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])+)(?:\.(?:(?:[0-9KSa-z\xA1-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])+-?)*(?:[0-9KSa-z\xA1-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])+)*(?:\.(?:(?:[KSa-z\xA1-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]){2,})))(?::[0-9]{2,5})?(?:\/(?:[\0-\x08\x0E-\x1F!-\x9F\xA1-\u167F\u1681-\u1FFF\u200B-\u2027\u202A-\u202E\u2030-\u205E\u2060-\u2FFF\u3001-\uD7FF\uE000-\uFEFE\uFF00-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])*)?$/i;
        var UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
        var JSON_POINTER = /^(?:\/(?:[^~\/]|~0|~1)*)*$|^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
        var RELATIVE_JSON_POINTER = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~\/]|~0|~1)*)*)$/;
        module.exports = formats;

        function formats(mode) {
            mode = mode == "full" ? "full" : "fast";
            return util.copy(formats[mode])
        }
        formats.fast = {
            date: /^\d\d\d\d-[0-1]\d-[0-3]\d$/,
            time: /^[0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:z|[+-]\d\d:\d\d)?$/i,
            "date-time": /^\d\d\d\d-[0-1]\d-[0-3]\d[t\s][0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:z|[+-]\d\d:\d\d)$/i,
            uri: /^(?:[a-z][a-z0-9+-.]*)(?::|\/)\/?[^\s]*$/i,
            "uri-reference": /^(?:(?:[a-z][a-z0-9+-.]*:)?\/\/)?[^\s]*$/i,
            "uri-template": URITEMPLATE,
            url: URL,
            email: /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
            hostname: HOSTNAME,
            ipv4: /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
            ipv6: /^\s*(?:(?:(?:[0-9a-f]{1,4}:){7}(?:[0-9a-f]{1,4}|:))|(?:(?:[0-9a-f]{1,4}:){6}(?::[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(?:(?:[0-9a-f]{1,4}:){5}(?:(?:(?::[0-9a-f]{1,4}){1,2})|:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(?:(?:[0-9a-f]{1,4}:){4}(?:(?:(?::[0-9a-f]{1,4}){1,3})|(?:(?::[0-9a-f]{1,4})?:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:[0-9a-f]{1,4}:){3}(?:(?:(?::[0-9a-f]{1,4}){1,4})|(?:(?::[0-9a-f]{1,4}){0,2}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:[0-9a-f]{1,4}:){2}(?:(?:(?::[0-9a-f]{1,4}){1,5})|(?:(?::[0-9a-f]{1,4}){0,3}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:[0-9a-f]{1,4}:){1}(?:(?:(?::[0-9a-f]{1,4}){1,6})|(?:(?::[0-9a-f]{1,4}){0,4}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?::(?:(?:(?::[0-9a-f]{1,4}){1,7})|(?:(?::[0-9a-f]{1,4}){0,5}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(?:%.+)?\s*$/i,
            regex: regex,
            uuid: UUID,
            "json-pointer": JSON_POINTER,
            "relative-json-pointer": RELATIVE_JSON_POINTER
        };
        formats.full = {
            date: date,
            time: time,
            "date-time": date_time,
            uri: uri,
            "uri-reference": URIREF,
            "uri-template": URITEMPLATE,
            url: URL,
            email: /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&''*+\/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
            hostname: hostname,
            ipv4: /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
            ipv6: /^\s*(?:(?:(?:[0-9a-f]{1,4}:){7}(?:[0-9a-f]{1,4}|:))|(?:(?:[0-9a-f]{1,4}:){6}(?::[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(?:(?:[0-9a-f]{1,4}:){5}(?:(?:(?::[0-9a-f]{1,4}){1,2})|:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(?:(?:[0-9a-f]{1,4}:){4}(?:(?:(?::[0-9a-f]{1,4}){1,3})|(?:(?::[0-9a-f]{1,4})?:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:[0-9a-f]{1,4}:){3}(?:(?:(?::[0-9a-f]{1,4}){1,4})|(?:(?::[0-9a-f]{1,4}){0,2}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:[0-9a-f]{1,4}:){2}(?:(?:(?::[0-9a-f]{1,4}){1,5})|(?:(?::[0-9a-f]{1,4}){0,3}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?:(?:[0-9a-f]{1,4}:){1}(?:(?:(?::[0-9a-f]{1,4}){1,6})|(?:(?::[0-9a-f]{1,4}){0,4}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(?::(?:(?:(?::[0-9a-f]{1,4}){1,7})|(?:(?::[0-9a-f]{1,4}){0,5}:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(?:%.+)?\s*$/i,
            regex: regex,
            uuid: UUID,
            "json-pointer": JSON_POINTER,
            "relative-json-pointer": RELATIVE_JSON_POINTER
        };

        function date(str) {
            var matches = str.match(DATE);
            if (!matches) return false;
            var month = +matches[1];
            var day = +matches[2];
            return month >= 1 && month <= 12 && day >= 1 && day <= DAYS[month]
        }

        function time(str, full) {
            var matches = str.match(TIME);
            if (!matches) return false;
            var hour = matches[1];
            var minute = matches[2];
            var second = matches[3];
            var timeZone = matches[5];
            return hour <= 23 && minute <= 59 && second <= 59 && (!full || timeZone)
        }
        var DATE_TIME_SEPARATOR = /t|\s/i;

        function date_time(str) {
            var dateTime = str.split(DATE_TIME_SEPARATOR);
            return dateTime.length == 2 && date(dateTime[0]) && time(dateTime[1], true)
        }

        function hostname(str) {
            return str.length <= 255 && HOSTNAME.test(str)
        }
        var NOT_URI_FRAGMENT = /\/|:/;

        function uri(str) {
            return NOT_URI_FRAGMENT.test(str) && URI.test(str)
        }
        var Z_ANCHOR = /[^\\]\\Z/;

        function regex(str) {
            if (Z_ANCHOR.test(str)) return false;
            try {
                new RegExp(str);
                return true
            } catch (e) {
                return false
            }
        }
    }, {
        "./util": 15
    }],
    10: [function (require, module, exports) {
        "use strict";
        var resolve = require("./resolve"),
            util = require("./util"),
            errorClasses = require("./error_classes"),
            stableStringify = require("fast-json-stable-stringify");
        var validateGenerator = require("../dotjs/validate");
        var co = require("co");
        var ucs2length = util.ucs2length;
        var equal = require("fast-deep-equal");
        var ValidationError = errorClasses.Validation;
        module.exports = compile;

        function compile(schema, root, localRefs, baseId) {
            var self = this,
                opts = this._opts,
                refVal = [undefined],
                refs = {},
                patterns = [],
                patternsHash = {},
                defaults = [],
                defaultsHash = {},
                customRules = [];
            root = root || {
                schema: schema,
                refVal: refVal,
                refs: refs
            };
            var c = checkCompiling.call(this, schema, root, baseId);
            var compilation = this._compilations[c.index];
            if (c.compiling) return compilation.callValidate = callValidate;
            var formats = this._formats;
            var RULES = this.RULES;
            try {
                var v = localCompile(schema, root, localRefs, baseId);
                compilation.validate = v;
                var cv = compilation.callValidate;
                if (cv) {
                    cv.schema = v.schema;
                    cv.errors = null;
                    cv.refs = v.refs;
                    cv.refVal = v.refVal;
                    cv.root = v.root;
                    cv.$async = v.$async;
                    if (opts.sourceCode) cv.source = v.source
                }
                return v
            } finally {
                endCompiling.call(this, schema, root, baseId)
            }

            function callValidate() {
                var validate = compilation.validate;
                var result = validate.apply(null, arguments);
                callValidate.errors = validate.errors;
                return result
            }

            function localCompile(_schema, _root, localRefs, baseId) {
                var isRoot = !_root || _root && _root.schema == _schema;
                if (_root.schema != root.schema) return compile.call(self, _schema, _root, localRefs, baseId);
                var $async = _schema.$async === true;
                var sourceCode = validateGenerator({
                    isTop: true,
                    schema: _schema,
                    isRoot: isRoot,
                    baseId: baseId,
                    root: _root,
                    schemaPath: "",
                    errSchemaPath: "#",
                    errorPath: '""',
                    MissingRefError: errorClasses.MissingRef,
                    RULES: RULES,
                    validate: validateGenerator,
                    util: util,
                    resolve: resolve,
                    resolveRef: resolveRef,
                    usePattern: usePattern,
                    useDefault: useDefault,
                    useCustomRule: useCustomRule,
                    opts: opts,
                    formats: formats,
                    logger: self.logger,
                    self: self
                });
                sourceCode = vars(refVal, refValCode) + vars(patterns, patternCode) + vars(defaults, defaultCode) + vars(customRules, customRuleCode) + sourceCode;
                if (opts.processCode) sourceCode = opts.processCode(sourceCode);
                var validate;
                try {
                    var makeValidate = new Function("self", "RULES", "formats", "root", "refVal", "defaults", "customRules", "co", "equal", "ucs2length", "ValidationError", sourceCode);
                    validate = makeValidate(self, RULES, formats, root, refVal, defaults, customRules, co, equal, ucs2length, ValidationError);
                    refVal[0] = validate
                } catch (e) {
                    self.logger.error("Error compiling schema, function code:", sourceCode);
                    throw e
                }
                validate.schema = _schema;
                validate.errors = null;
                validate.refs = refs;
                validate.refVal = refVal;
                validate.root = isRoot ? validate : _root;
                if ($async) validate.$async = true;
                if (opts.sourceCode === true) {
                    validate.source = {
                        code: sourceCode,
                        patterns: patterns,
                        defaults: defaults
                    }
                }
                return validate
            }

            function resolveRef(baseId, ref, isRoot) {
                ref = resolve.url(baseId, ref);
                var refIndex = refs[ref];
                var _refVal, refCode;
                if (refIndex !== undefined) {
                    _refVal = refVal[refIndex];
                    refCode = "refVal[" + refIndex + "]";
                    return resolvedRef(_refVal, refCode)
                }
                if (!isRoot && root.refs) {
                    var rootRefId = root.refs[ref];
                    if (rootRefId !== undefined) {
                        _refVal = root.refVal[rootRefId];
                        refCode = addLocalRef(ref, _refVal);
                        return resolvedRef(_refVal, refCode)
                    }
                }
                refCode = addLocalRef(ref);
                var v = resolve.call(self, localCompile, root, ref);
                if (v === undefined) {
                    var localSchema = localRefs && localRefs[ref];
                    if (localSchema) {
                        v = resolve.inlineRef(localSchema, opts.inlineRefs) ? localSchema : compile.call(self, localSchema, root, localRefs, baseId)
                    }
                }
                if (v === undefined) {
                    removeLocalRef(ref)
                } else {
                    replaceLocalRef(ref, v);
                    return resolvedRef(v, refCode)
                }
            }

            function addLocalRef(ref, v) {
                var refId = refVal.length;
                refVal[refId] = v;
                refs[ref] = refId;
                return "refVal" + refId
            }

            function removeLocalRef(ref) {
                delete refs[ref]
            }

            function replaceLocalRef(ref, v) {
                var refId = refs[ref];
                refVal[refId] = v
            }

            function resolvedRef(refVal, code) {
                return typeof refVal == "object" || typeof refVal == "boolean" ? {
                    code: code,
                    schema: refVal,
                    inline: true
                } : {
                    code: code,
                    $async: refVal && refVal.$async
                }
            }

            function usePattern(regexStr) {
                var index = patternsHash[regexStr];
                if (index === undefined) {
                    index = patternsHash[regexStr] = patterns.length;
                    patterns[index] = regexStr
                }
                return "pattern" + index
            }

            function useDefault(value) {
                switch (typeof value) {
                    case "boolean":
                    case "number":
                        return "" + value;
                    case "string":
                        return util.toQuotedString(value);
                    case "object":
                        if (value === null) return "null";
                        var valueStr = stableStringify(value);
                        var index = defaultsHash[valueStr];
                        if (index === undefined) {
                            index = defaultsHash[valueStr] = defaults.length;
                            defaults[index] = value
                        }
                        return "default" + index
                }
            }

            function useCustomRule(rule, schema, parentSchema, it) {
                var validateSchema = rule.definition.validateSchema;
                if (validateSchema && self._opts.validateSchema !== false) {
                    var valid = validateSchema(schema);
                    if (!valid) {
                        var message = "keyword schema is invalid: " + self.errorsText(validateSchema.errors);
                        if (self._opts.validateSchema == "log") self.logger.error(message);
                        else throw new Error(message)
                    }
                }
                var compile = rule.definition.compile,
                    inline = rule.definition.inline,
                    macro = rule.definition.macro;
                var validate;
                if (compile) {
                    validate = compile.call(self, schema, parentSchema, it)
                } else if (macro) {
                    validate = macro.call(self, schema, parentSchema, it);
                    if (opts.validateSchema !== false) self.validateSchema(validate, true)
                } else if (inline) {
                    validate = inline.call(self, it, rule.keyword, schema, parentSchema)
                } else {
                    validate = rule.definition.validate;
                    if (!validate) return
                }
                if (validate === undefined) throw new Error('custom keyword "' + rule.keyword + '"failed to compile');
                var index = customRules.length;
                customRules[index] = validate;
                return {
                    code: "customRule" + index,
                    validate: validate
                }
            }
        }

        function checkCompiling(schema, root, baseId) {
            var index = compIndex.call(this, schema, root, baseId);
            if (index >= 0) return {
                index: index,
                compiling: true
            };
            index = this._compilations.length;
            this._compilations[index] = {
                schema: schema,
                root: root,
                baseId: baseId
            };
            return {
                index: index,
                compiling: false
            }
        }

        function endCompiling(schema, root, baseId) {
            var i = compIndex.call(this, schema, root, baseId);
            if (i >= 0) this._compilations.splice(i, 1)
        }

        function compIndex(schema, root, baseId) {
            for (var i = 0; i < this._compilations.length; i++) {
                var c = this._compilations[i];
                if (c.schema == schema && c.root == root && c.baseId == baseId) return i
            }
            return -1
        }

        function patternCode(i, patterns) {
            return "var pattern" + i + " = new RegExp(" + util.toQuotedString(patterns[i]) + ");"
        }

        function defaultCode(i) {
            return "var default" + i + " = defaults[" + i + "];"
        }

        function refValCode(i, refVal) {
            return refVal[i] === undefined ? "" : "var refVal" + i + " = refVal[" + i + "];"
        }

        function customRuleCode(i) {
            return "var customRule" + i + " = customRules[" + i + "];"
        }

        function vars(arr, statement) {
            if (!arr.length) return "";
            var code = "";
            for (var i = 0; i < arr.length; i++) code += statement(i, arr);
            return code
        }
    }, {
        "../dotjs/validate": 38,
        "./error_classes": 8,
        "./resolve": 11,
        "./util": 15,
        co: 47,
        "fast-deep-equal": 53,
        "fast-json-stable-stringify": 54
    }],
    11: [function (require, module, exports) {
        "use strict";
        var url = require("url"),
            equal = require("fast-deep-equal"),
            util = require("./util"),
            SchemaObject = require("./schema_obj"),
            traverse = require("json-schema-traverse");
        module.exports = resolve;
        resolve.normalizeId = normalizeId;
        resolve.fullPath = getFullPath;
        resolve.url = resolveUrl;
        resolve.ids = resolveIds;
        resolve.inlineRef = inlineRef;
        resolve.schema = resolveSchema;

        function resolve(compile, root, ref) {
            var refVal = this._refs[ref];
            if (typeof refVal == "string") {
                if (this._refs[refVal]) refVal = this._refs[refVal];
                else return resolve.call(this, compile, root, refVal)
            }
            refVal = refVal || this._schemas[ref];
            if (refVal instanceof SchemaObject) {
                return inlineRef(refVal.schema, this._opts.inlineRefs) ? refVal.schema : refVal.validate || this._compile(refVal)
            }
            var res = resolveSchema.call(this, root, ref);
            var schema, v, baseId;
            if (res) {
                schema = res.schema;
                root = res.root;
                baseId = res.baseId
            }
            if (schema instanceof SchemaObject) {
                v = schema.validate || compile.call(this, schema.schema, root, undefined, baseId)
            } else if (schema !== undefined) {
                v = inlineRef(schema, this._opts.inlineRefs) ? schema : compile.call(this, schema, root, undefined, baseId)
            }
            return v
        }

        function resolveSchema(root, ref) {
            var p = url.parse(ref, false, true),
                refPath = _getFullPath(p),
                baseId = getFullPath(this._getId(root.schema));
            if (refPath !== baseId) {
                var id = normalizeId(refPath);
                var refVal = this._refs[id];
                if (typeof refVal == "string") {
                    return resolveRecursive.call(this, root, refVal, p)
                } else if (refVal instanceof SchemaObject) {
                    if (!refVal.validate) this._compile(refVal);
                    root = refVal
                } else {
                    refVal = this._schemas[id];
                    if (refVal instanceof SchemaObject) {
                        if (!refVal.validate) this._compile(refVal);
                        if (id == normalizeId(ref)) return {
                            schema: refVal,
                            root: root,
                            baseId: baseId
                        };
                        root = refVal
                    } else {
                        return
                    }
                }
                if (!root.schema) return;
                baseId = getFullPath(this._getId(root.schema))
            }
            return getJsonPointer.call(this, p, baseId, root.schema, root)
        }

        function resolveRecursive(root, ref, parsedRef) {
            var res = resolveSchema.call(this, root, ref);
            if (res) {
                var schema = res.schema;
                var baseId = res.baseId;
                root = res.root;
                var id = this._getId(schema);
                if (id) baseId = resolveUrl(baseId, id);
                return getJsonPointer.call(this, parsedRef, baseId, schema, root)
            }
        }
        var PREVENT_SCOPE_CHANGE = util.toHash(["properties", "patternProperties", "enum", "dependencies", "definitions"]);

        function getJsonPointer(parsedRef, baseId, schema, root) {
            parsedRef.hash = parsedRef.hash || "";
            if (parsedRef.hash.slice(0, 2) != "#/") return;
            var parts = parsedRef.hash.split("/");
            for (var i = 1; i < parts.length; i++) {
                var part = parts[i];
                if (part) {
                    part = util.unescapeFragment(part);
                    schema = schema[part];
                    if (schema === undefined) break;
                    var id;
                    if (!PREVENT_SCOPE_CHANGE[part]) {
                        id = this._getId(schema);
                        if (id) baseId = resolveUrl(baseId, id);
                        if (schema.$ref) {
                            var $ref = resolveUrl(baseId, schema.$ref);
                            var res = resolveSchema.call(this, root, $ref);
                            if (res) {
                                schema = res.schema;
                                root = res.root;
                                baseId = res.baseId
                            }
                        }
                    }
                }
            }
            if (schema !== undefined && schema !== root.schema) return {
                schema: schema,
                root: root,
                baseId: baseId
            }
        }
        var SIMPLE_INLINED = util.toHash(["type", "format", "pattern", "maxLength", "minLength", "maxProperties", "minProperties", "maxItems", "minItems", "maximum", "minimum", "uniqueItems", "multipleOf", "required", "enum"]);

        function inlineRef(schema, limit) {
            if (limit === false) return false;
            if (limit === undefined || limit === true) return checkNoRef(schema);
            else if (limit) return countKeys(schema) <= limit
        }

        function checkNoRef(schema) {
            var item;
            if (Array.isArray(schema)) {
                for (var i = 0; i < schema.length; i++) {
                    item = schema[i];
                    if (typeof item == "object" && !checkNoRef(item)) return false
                }
            } else {
                for (var key in schema) {
                    if (key == "$ref") return false;
                    item = schema[key];
                    if (typeof item == "object" && !checkNoRef(item)) return false
                }
            }
            return true
        }

        function countKeys(schema) {
            var count = 0,
                item;
            if (Array.isArray(schema)) {
                for (var i = 0; i < schema.length; i++) {
                    item = schema[i];
                    if (typeof item == "object") count += countKeys(item);
                    if (count == Infinity) return Infinity
                }
            } else {
                for (var key in schema) {
                    if (key == "$ref") return Infinity;
                    if (SIMPLE_INLINED[key]) {
                        count++
                    } else {
                        item = schema[key];
                        if (typeof item == "object") count += countKeys(item) + 1;
                        if (count == Infinity) return Infinity
                    }
                }
            }
            return count
        }

        function getFullPath(id, normalize) {
            if (normalize !== false) id = normalizeId(id);
            var p = url.parse(id, false, true);
            return _getFullPath(p)
        }

        function _getFullPath(p) {
            var protocolSeparator = p.protocol || p.href.slice(0, 2) == "//" ? "//" : "";
            return (p.protocol || "") + protocolSeparator + (p.host || "") + (p.path || "") + "#"
        }
        var TRAILING_SLASH_HASH = /#\/?$/;

        function normalizeId(id) {
            return id ? id.replace(TRAILING_SLASH_HASH, "") : ""
        }

        function resolveUrl(baseId, id) {
            id = normalizeId(id);
            return url.resolve(baseId, id)
        }

        function resolveIds(schema) {
            var schemaId = normalizeId(this._getId(schema));
            var baseIds = {
                "": schemaId
            };
            var fullPaths = {
                "": getFullPath(schemaId, false)
            };
            var localRefs = {};
            var self = this;
            traverse(schema, {
                allKeys: true
            }, function (sch, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
                if (jsonPtr === "") return;
                var id = self._getId(sch);
                var baseId = baseIds[parentJsonPtr];
                var fullPath = fullPaths[parentJsonPtr] + "/" + parentKeyword;
                if (keyIndex !== undefined) fullPath += "/" + (typeof keyIndex == "number" ? keyIndex : util.escapeFragment(keyIndex));
                if (typeof id == "string") {
                    id = baseId = normalizeId(baseId ? url.resolve(baseId, id) : id);
                    var refVal = self._refs[id];
                    if (typeof refVal == "string") refVal = self._refs[refVal];
                    if (refVal && refVal.schema) {
                        if (!equal(sch, refVal.schema)) throw new Error('id "' + id + '" resolves to more than one schema')
                    } else if (id != normalizeId(fullPath)) {
                        if (id[0] == "#") {
                            if (localRefs[id] && !equal(sch, localRefs[id])) throw new Error('id "' + id + '" resolves to more than one schema');
                            localRefs[id] = sch
                        } else {
                            self._refs[id] = fullPath
                        }
                    }
                }
                baseIds[jsonPtr] = baseId;
                fullPaths[jsonPtr] = fullPath
            });
            return localRefs
        }
    }, {
        "./schema_obj": 13,
        "./util": 15,
        "fast-deep-equal": 53,
        "json-schema-traverse": 58,
        url: 74
    }],
    12: [function (require, module, exports) {
        "use strict";
        var ruleModules = require("./_rules"),
            toHash = require("./util").toHash;
        module.exports = function rules() {
            var RULES = [{
                type: "number",
                rules: [{
                    maximum: ["exclusiveMaximum"]
                }, {
                    minimum: ["exclusiveMinimum"]
                }, "multipleOf", "format"]
            }, {
                type: "string",
                rules: ["maxLength", "minLength", "pattern", "format"]
            }, {
                type: "array",
                rules: ["maxItems", "minItems", "uniqueItems", "contains", "items"]
            }, {
                type: "object",
                rules: ["maxProperties", "minProperties", "required", "dependencies", "propertyNames", {
                    properties: ["additionalProperties", "patternProperties"]
                }]
            }, {
                rules: ["$ref", "const", "enum", "not", "anyOf", "oneOf", "allOf"]
            }];
            var ALL = ["type"];
            var KEYWORDS = ["additionalItems", "$schema", "$id", "id", "title", "description", "default", "definitions"];
            var TYPES = ["number", "integer", "string", "array", "object", "boolean", "null"];
            RULES.all = toHash(ALL);
            RULES.types = toHash(TYPES);
            RULES.forEach(function (group) {
                group.rules = group.rules.map(function (keyword) {
                    var implKeywords;
                    if (typeof keyword == "object") {
                        var key = Object.keys(keyword)[0];
                        implKeywords = keyword[key];
                        keyword = key;
                        implKeywords.forEach(function (k) {
                            ALL.push(k);
                            RULES.all[k] = true
                        })
                    }
                    ALL.push(keyword);
                    var rule = RULES.all[keyword] = {
                        keyword: keyword,
                        code: ruleModules[keyword],
                        implements: implKeywords
                    };
                    return rule
                });
                if (group.type) RULES.types[group.type] = group
            });
            RULES.keywords = toHash(ALL.concat(KEYWORDS));
            RULES.custom = {};
            return RULES
        }
    }, {
        "./_rules": 6,
        "./util": 15
    }],
    13: [function (require, module, exports) {
        "use strict";
        var util = require("./util");
        module.exports = SchemaObject;

        function SchemaObject(obj) {
            util.copy(obj, this)
        }
    }, {
        "./util": 15
    }],
    14: [function (require, module, exports) {
        "use strict";
        module.exports = function ucs2length(str) {
            var length = 0,
                len = str.length,
                pos = 0,
                value;
            while (pos < len) {
                length++;
                value = str.charCodeAt(pos++);
                if (value >= 55296 && value <= 56319 && pos < len) {
                    value = str.charCodeAt(pos);
                    if ((value & 64512) == 56320) pos++
                }
            }
            return length
        }
    }, {}],
    15: [function (require, module, exports) {
        "use strict";
        module.exports = {
            copy: copy,
            checkDataType: checkDataType,
            checkDataTypes: checkDataTypes,
            coerceToTypes: coerceToTypes,
            toHash: toHash,
            getProperty: getProperty,
            escapeQuotes: escapeQuotes,
            equal: require("fast-deep-equal"),
            ucs2length: require("./ucs2length"),
            varOccurences: varOccurences,
            varReplace: varReplace,
            cleanUpCode: cleanUpCode,
            finalCleanUpCode: finalCleanUpCode,
            schemaHasRules: schemaHasRules,
            schemaHasRulesExcept: schemaHasRulesExcept,
            toQuotedString: toQuotedString,
            getPathExpr: getPathExpr,
            getPath: getPath,
            getData: getData,
            unescapeFragment: unescapeFragment,
            unescapeJsonPointer: unescapeJsonPointer,
            escapeFragment: escapeFragment,
            escapeJsonPointer: escapeJsonPointer
        };

        function copy(o, to) {
            to = to || {};
            for (var key in o) to[key] = o[key];
            return to
        }

        function checkDataType(dataType, data, negate) {
            var EQUAL = negate ? " !== " : " === ",
                AND = negate ? " || " : " && ",
                OK = negate ? "!" : "",
                NOT = negate ? "" : "!";
            switch (dataType) {
                case "null":
                    return data + EQUAL + "null";
                case "array":
                    return OK + "Array.isArray(" + data + ")";
                case "object":
                    return "(" + OK + data + AND + "typeof " + data + EQUAL + '"object"' + AND + NOT + "Array.isArray(" + data + "))";
                case "integer":
                    return "(typeof " + data + EQUAL + '"number"' + AND + NOT + "(" + data + " % 1)" + AND + data + EQUAL + data + ")";
                default:
                    return "typeof " + data + EQUAL + '"' + dataType + '"'
            }
        }

        function checkDataTypes(dataTypes, data) {
            switch (dataTypes.length) {
                case 1:
                    return checkDataType(dataTypes[0], data, true);
                default:
                    var code = "";
                    var types = toHash(dataTypes);
                    if (types.array && types.object) {
                        code = types.null ? "(" : "(!" + data + " || ";
                        code += "typeof " + data + ' !== "object")';
                        delete types.null;
                        delete types.array;
                        delete types.object
                    }
                    if (types.number) delete types.integer;
                    for (var t in types) code += (code ? " && " : "") + checkDataType(t, data, true);
                    return code
            }
        }
        var COERCE_TO_TYPES = toHash(["string", "number", "integer", "boolean", "null"]);

        function coerceToTypes(optionCoerceTypes, dataTypes) {
            if (Array.isArray(dataTypes)) {
                var types = [];
                for (var i = 0; i < dataTypes.length; i++) {
                    var t = dataTypes[i];
                    if (COERCE_TO_TYPES[t]) types[types.length] = t;
                    else if (optionCoerceTypes === "array" && t === "array") types[types.length] = t
                }
                if (types.length) return types
            } else if (COERCE_TO_TYPES[dataTypes]) {
                return [dataTypes]
            } else if (optionCoerceTypes === "array" && dataTypes === "array") {
                return ["array"]
            }
        }

        function toHash(arr) {
            var hash = {};
            for (var i = 0; i < arr.length; i++) hash[arr[i]] = true;
            return hash
        }
        var IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
        var SINGLE_QUOTE = /'|\\/g;

        function getProperty(key) {
            return typeof key == "number" ? "[" + key + "]" : IDENTIFIER.test(key) ? "." + key : "['" + escapeQuotes(key) + "']"
        }

        function escapeQuotes(str) {
            return str.replace(SINGLE_QUOTE, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\f/g, "\\f").replace(/\t/g, "\\t")
        }

        function varOccurences(str, dataVar) {
            dataVar += "[^0-9]";
            var matches = str.match(new RegExp(dataVar, "g"));
            return matches ? matches.length : 0
        }

        function varReplace(str, dataVar, expr) {
            dataVar += "([^0-9])";
            expr = expr.replace(/\$/g, "$$$$");
            return str.replace(new RegExp(dataVar, "g"), expr + "$1")
        }
        var EMPTY_ELSE = /else\s*{\s*}/g,
            EMPTY_IF_NO_ELSE = /if\s*\([^)]+\)\s*\{\s*\}(?!\s*else)/g,
            EMPTY_IF_WITH_ELSE = /if\s*\(([^)]+)\)\s*\{\s*\}\s*else(?!\s*if)/g;

        function cleanUpCode(out) {
            return out.replace(EMPTY_ELSE, "").replace(EMPTY_IF_NO_ELSE, "").replace(EMPTY_IF_WITH_ELSE, "if (!($1))")
        }
        var ERRORS_REGEXP = /[^v.]errors/g,
            REMOVE_ERRORS = /var errors = 0;|var vErrors = null;|validate.errors = vErrors;/g,
            REMOVE_ERRORS_ASYNC = /var errors = 0;|var vErrors = null;/g,
            RETURN_VALID = "return errors === 0;",
            RETURN_TRUE = "validate.errors = null; return true;",
            RETURN_ASYNC = /if \(errors === 0\) return data;\s*else throw new ValidationError\(vErrors\);/,
            RETURN_DATA_ASYNC = "return data;",
            ROOTDATA_REGEXP = /[^A-Za-z_$]rootData[^A-Za-z0-9_$]/g,
            REMOVE_ROOTDATA = /if \(rootData === undefined\) rootData = data;/;

        function finalCleanUpCode(out, async) {
            var matches = out.match(ERRORS_REGEXP);
            if (matches && matches.length == 2) {
                out = async ?out.replace(REMOVE_ERRORS_ASYNC, "").replace(RETURN_ASYNC, RETURN_DATA_ASYNC): out.replace(REMOVE_ERRORS, "").replace(RETURN_VALID, RETURN_TRUE)
            }
            matches = out.match(ROOTDATA_REGEXP);
            if (!matches || matches.length !== 3) return out;
            return out.replace(REMOVE_ROOTDATA, "")
        }

        function schemaHasRules(schema, rules) {
            if (typeof schema == "boolean") return !schema;
            for (var key in schema)
                if (rules[key]) return true
        }

        function schemaHasRulesExcept(schema, rules, exceptKeyword) {
            if (typeof schema == "boolean") return !schema && exceptKeyword != "not";
            for (var key in schema)
                if (key != exceptKeyword && rules[key]) return true
        }

        function toQuotedString(str) {
            return "'" + escapeQuotes(str) + "'"
        }

        function getPathExpr(currentPath, expr, jsonPointers, isNumber) {
            var path = jsonPointers ? "'/' + " + expr + (isNumber ? "" : ".replace(/~/g, '~0').replace(/\\//g, '~1')") : isNumber ? "'[' + " + expr + " + ']'" : "'[\\'' + " + expr + " + '\\']'";
            return joinPaths(currentPath, path)
        }

        function getPath(currentPath, prop, jsonPointers) {
            var path = jsonPointers ? toQuotedString("/" + escapeJsonPointer(prop)) : toQuotedString(getProperty(prop));
            return joinPaths(currentPath, path)
        }
        var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
        var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;

        function getData($data, lvl, paths) {
            var up, jsonPointer, data, matches;
            if ($data === "") return "rootData";
            if ($data[0] == "/") {
                if (!JSON_POINTER.test($data)) throw new Error("Invalid JSON-pointer: " + $data);
                jsonPointer = $data;
                data = "rootData"
            } else {
                matches = $data.match(RELATIVE_JSON_POINTER);
                if (!matches) throw new Error("Invalid JSON-pointer: " + $data);
                up = +matches[1];
                jsonPointer = matches[2];
                if (jsonPointer == "#") {
                    if (up >= lvl) throw new Error("Cannot access property/index " + up + " levels up, current level is " + lvl);
                    return paths[lvl - up]
                }
                if (up > lvl) throw new Error("Cannot access data " + up + " levels up, current level is " + lvl);
                data = "data" + (lvl - up || "");
                if (!jsonPointer) return data
            }
            var expr = data;
            var segments = jsonPointer.split("/");
            for (var i = 0; i < segments.length; i++) {
                var segment = segments[i];
                if (segment) {
                    data += getProperty(unescapeJsonPointer(segment));
                    expr += " && " + data
                }
            }
            return expr
        }

        function joinPaths(a, b) {
            if (a == '""') return b;
            return (a + " + " + b).replace(/' \+ '/g, "")
        }

        function unescapeFragment(str) {
            return unescapeJsonPointer(decodeURIComponent(str))
        }

        function escapeFragment(str) {
            return encodeURIComponent(escapeJsonPointer(str))
        }

        function escapeJsonPointer(str) {
            return str.replace(/~/g, "~0").replace(/\//g, "~1")
        }

        function unescapeJsonPointer(str) {
            return str.replace(/~1/g, "/").replace(/~0/g, "~")
        }
    }, {
        "./ucs2length": 14,
        "fast-deep-equal": 53
    }],
    16: [function (require, module, exports) {
        "use strict";
        module.exports = function generate__limit(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $errorKeyword;
            var $data = "data" + ($dataLvl || "");
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $isMax = $keyword == "maximum",
                $exclusiveKeyword = $isMax ? "exclusiveMaximum" : "exclusiveMinimum",
                $schemaExcl = it.schema[$exclusiveKeyword],
                $isDataExcl = it.opts.$data && $schemaExcl && $schemaExcl.$data,
                $op = $isMax ? "<" : ">",
                $notOp = $isMax ? ">" : "<",
                $errorKeyword = undefined;
            if ($isDataExcl) {
                var $schemaValueExcl = it.util.getData($schemaExcl.$data, $dataLvl, it.dataPathArr),
                    $exclusive = "exclusive" + $lvl,
                    $exclType = "exclType" + $lvl,
                    $exclIsNumber = "exclIsNumber" + $lvl,
                    $opExpr = "op" + $lvl,
                    $opStr = "' + " + $opExpr + " + '";
                out += " var schemaExcl" + $lvl + " = " + $schemaValueExcl + "; ";
                $schemaValueExcl = "schemaExcl" + $lvl;
                out += " var " + $exclusive + "; var " + $exclType + " = typeof " + $schemaValueExcl + "; if (" + $exclType + " != 'boolean' && " + $exclType + " != 'undefined' && " + $exclType + " != 'number') { ";
                var $errorKeyword = $exclusiveKeyword;
                var $$outStack = $$outStack || [];
                $$outStack.push(out);
                out = "";
                if (it.createErrors !== false) {
                    out += " { keyword: '" + ($errorKeyword || "_exclusiveLimit") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                    if (it.opts.messages !== false) {
                        out += " , message: '" + $exclusiveKeyword + " should be boolean' "
                    }
                    if (it.opts.verbose) {
                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                    }
                    out += " } "
                } else {
                    out += " {} "
                }
                var __err = out;
                out = $$outStack.pop();
                if (!it.compositeRule && $breakOnError) {
                    if (it.async) {
                        out += " throw new ValidationError([" + __err + "]); "
                    } else {
                        out += " validate.errors = [" + __err + "]; return false; "
                    }
                } else {
                    out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                }
                out += " } else if ( ";
                if ($isData) {
                    out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'number') || "
                }
                out += " " + $exclType + " == 'number' ? ( (" + $exclusive + " = " + $schemaValue + " === undefined || " + $schemaValueExcl + " " + $op + "= " + $schemaValue + ") ? " + $data + " " + $notOp + "= " + $schemaValueExcl + " : " + $data + " " + $notOp + " " + $schemaValue + " ) : ( (" + $exclusive + " = " + $schemaValueExcl + " === true) ? " + $data + " " + $notOp + "= " + $schemaValue + " : " + $data + " " + $notOp + " " + $schemaValue + " ) || " + $data + " !== " + $data + ") { var op" + $lvl + " = " + $exclusive + " ? '" + $op + "' : '" + $op + "=';"
            } else {
                var $exclIsNumber = typeof $schemaExcl == "number",
                    $opStr = $op;
                if ($exclIsNumber && $isData) {
                    var $opExpr = "'" + $opStr + "'";
                    out += " if ( ";
                    if ($isData) {
                        out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'number') || "
                    }
                    out += " ( " + $schemaValue + " === undefined || " + $schemaExcl + " " + $op + "= " + $schemaValue + " ? " + $data + " " + $notOp + "= " + $schemaExcl + " : " + $data + " " + $notOp + " " + $schemaValue + " ) || " + $data + " !== " + $data + ") { "
                } else {
                    if ($exclIsNumber && $schema === undefined) {
                        $exclusive = true;
                        $errorKeyword = $exclusiveKeyword;
                        $errSchemaPath = it.errSchemaPath + "/" + $exclusiveKeyword;
                        $schemaValue = $schemaExcl;
                        $notOp += "="
                    } else {
                        if ($exclIsNumber) $schemaValue = Math[$isMax ? "min" : "max"]($schemaExcl, $schema);
                        if ($schemaExcl === ($exclIsNumber ? $schemaValue : true)) {
                            $exclusive = true;
                            $errorKeyword = $exclusiveKeyword;
                            $errSchemaPath = it.errSchemaPath + "/" + $exclusiveKeyword;
                            $notOp += "="
                        } else {
                            $exclusive = false;
                            $opStr += "="
                        }
                    }
                    var $opExpr = "'" + $opStr + "'";
                    out += " if ( ";
                    if ($isData) {
                        out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'number') || "
                    }
                    out += " " + $data + " " + $notOp + " " + $schemaValue + " || " + $data + " !== " + $data + ") { "
                }
            }
            $errorKeyword = $errorKeyword || $keyword;
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + ($errorKeyword || "_limit") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { comparison: " + $opExpr + ", limit: " + $schemaValue + ", exclusive: " + $exclusive + " } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should be " + $opStr + " ";
                    if ($isData) {
                        out += "' + " + $schemaValue
                    } else {
                        out += "" + $schemaValue + "'"
                    }
                }
                if (it.opts.verbose) {
                    out += " , schema:  ";
                    if ($isData) {
                        out += "validate.schema" + $schemaPath
                    } else {
                        out += "" + $schema
                    }
                    out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += " } ";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    17: [function (require, module, exports) {
        "use strict";
        module.exports = function generate__limitItems(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $errorKeyword;
            var $data = "data" + ($dataLvl || "");
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $op = $keyword == "maxItems" ? ">" : "<";
            out += "if ( ";
            if ($isData) {
                out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'number') || "
            }
            out += " " + $data + ".length " + $op + " " + $schemaValue + ") { ";
            var $errorKeyword = $keyword;
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + ($errorKeyword || "_limitItems") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { limit: " + $schemaValue + " } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should NOT have ";
                    if ($keyword == "maxItems") {
                        out += "more"
                    } else {
                        out += "less"
                    }
                    out += " than ";
                    if ($isData) {
                        out += "' + " + $schemaValue + " + '"
                    } else {
                        out += "" + $schema
                    }
                    out += " items' "
                }
                if (it.opts.verbose) {
                    out += " , schema:  ";
                    if ($isData) {
                        out += "validate.schema" + $schemaPath
                    } else {
                        out += "" + $schema
                    }
                    out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += "} ";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    18: [function (require, module, exports) {
        "use strict";
        module.exports = function generate__limitLength(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $errorKeyword;
            var $data = "data" + ($dataLvl || "");
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $op = $keyword == "maxLength" ? ">" : "<";
            out += "if ( ";
            if ($isData) {
                out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'number') || "
            }
            if (it.opts.unicode === false) {
                out += " " + $data + ".length "
            } else {
                out += " ucs2length(" + $data + ") "
            }
            out += " " + $op + " " + $schemaValue + ") { ";
            var $errorKeyword = $keyword;
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + ($errorKeyword || "_limitLength") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { limit: " + $schemaValue + " } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should NOT be ";
                    if ($keyword == "maxLength") {
                        out += "longer"
                    } else {
                        out += "shorter"
                    }
                    out += " than ";
                    if ($isData) {
                        out += "' + " + $schemaValue + " + '"
                    } else {
                        out += "" + $schema
                    }
                    out += " characters' "
                }
                if (it.opts.verbose) {
                    out += " , schema:  ";
                    if ($isData) {
                        out += "validate.schema" + $schemaPath
                    } else {
                        out += "" + $schema
                    }
                    out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += "} ";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    19: [function (require, module, exports) {
        "use strict";
        module.exports = function generate__limitProperties(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $errorKeyword;
            var $data = "data" + ($dataLvl || "");
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $op = $keyword == "maxProperties" ? ">" : "<";
            out += "if ( ";
            if ($isData) {
                out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'number') || "
            }
            out += " Object.keys(" + $data + ").length " + $op + " " + $schemaValue + ") { ";
            var $errorKeyword = $keyword;
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + ($errorKeyword || "_limitProperties") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { limit: " + $schemaValue + " } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should NOT have ";
                    if ($keyword == "maxProperties") {
                        out += "more"
                    } else {
                        out += "less"
                    }
                    out += " than ";
                    if ($isData) {
                        out += "' + " + $schemaValue + " + '"
                    } else {
                        out += "" + $schema
                    }
                    out += " properties' "
                }
                if (it.opts.verbose) {
                    out += " , schema:  ";
                    if ($isData) {
                        out += "validate.schema" + $schemaPath
                    } else {
                        out += "" + $schema
                    }
                    out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += "} ";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    20: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_allOf(it, $keyword, $ruleType) {
            var out = " ";
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            var $currentBaseId = $it.baseId,
                $allSchemasEmpty = true;
            var arr1 = $schema;
            if (arr1) {
                var $sch, $i = -1,
                    l1 = arr1.length - 1;
                while ($i < l1) {
                    $sch = arr1[$i += 1];
                    if (it.util.schemaHasRules($sch, it.RULES.all)) {
                        $allSchemasEmpty = false;
                        $it.schema = $sch;
                        $it.schemaPath = $schemaPath + "[" + $i + "]";
                        $it.errSchemaPath = $errSchemaPath + "/" + $i;
                        out += "  " + it.validate($it) + " ";
                        $it.baseId = $currentBaseId;
                        if ($breakOnError) {
                            out += " if (" + $nextValid + ") { ";
                            $closingBraces += "}"
                        }
                    }
                }
            }
            if ($breakOnError) {
                if ($allSchemasEmpty) {
                    out += " if (true) { "
                } else {
                    out += " " + $closingBraces.slice(0, -1) + " "
                }
            }
            out = it.util.cleanUpCode(out);
            return out
        }
    }, {}],
    21: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_anyOf(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            var $noEmptySchema = $schema.every(function ($sch) {
                return it.util.schemaHasRules($sch, it.RULES.all)
            });
            if ($noEmptySchema) {
                var $currentBaseId = $it.baseId;
                out += " var " + $errs + " = errors; var " + $valid + " = false;  ";
                var $wasComposite = it.compositeRule;
                it.compositeRule = $it.compositeRule = true;
                var arr1 = $schema;
                if (arr1) {
                    var $sch, $i = -1,
                        l1 = arr1.length - 1;
                    while ($i < l1) {
                        $sch = arr1[$i += 1];
                        $it.schema = $sch;
                        $it.schemaPath = $schemaPath + "[" + $i + "]";
                        $it.errSchemaPath = $errSchemaPath + "/" + $i;
                        out += "  " + it.validate($it) + " ";
                        $it.baseId = $currentBaseId;
                        out += " " + $valid + " = " + $valid + " || " + $nextValid + "; if (!" + $valid + ") { ";
                        $closingBraces += "}"
                    }
                }
                it.compositeRule = $it.compositeRule = $wasComposite;
                out += " " + $closingBraces + " if (!" + $valid + ") {   var err =   ";
                if (it.createErrors !== false) {
                    out += " { keyword: '" + "anyOf" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                    if (it.opts.messages !== false) {
                        out += " , message: 'should match some schema in anyOf' "
                    }
                    if (it.opts.verbose) {
                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                    }
                    out += " } "
                } else {
                    out += " {} "
                }
                out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; ";
                if (!it.compositeRule && $breakOnError) {
                    if (it.async) {
                        out += " throw new ValidationError(vErrors); "
                    } else {
                        out += " validate.errors = vErrors; return false; "
                    }
                }
                out += " } else {  errors = " + $errs + "; if (vErrors !== null) { if (" + $errs + ") vErrors.length = " + $errs + "; else vErrors = null; } ";
                if (it.opts.allErrors) {
                    out += " } "
                }
                out = it.util.cleanUpCode(out)
            } else {
                if ($breakOnError) {
                    out += " if (true) { "
                }
            }
            return out
        }
    }, {}],
    22: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_const(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            if (!$isData) {
                out += " var schema" + $lvl + " = validate.schema" + $schemaPath + ";"
            }
            out += "var " + $valid + " = equal(" + $data + ", schema" + $lvl + "); if (!" + $valid + ") {   ";
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + "const" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should be equal to constant' "
                }
                if (it.opts.verbose) {
                    out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += " }";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    23: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_contains(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            var $idx = "i" + $lvl,
                $dataNxt = $it.dataLevel = it.dataLevel + 1,
                $nextData = "data" + $dataNxt,
                $currentBaseId = it.baseId,
                $nonEmptySchema = it.util.schemaHasRules($schema, it.RULES.all);
            out += "var " + $errs + " = errors;var " + $valid + ";";
            if ($nonEmptySchema) {
                var $wasComposite = it.compositeRule;
                it.compositeRule = $it.compositeRule = true;
                $it.schema = $schema;
                $it.schemaPath = $schemaPath;
                $it.errSchemaPath = $errSchemaPath;
                out += " var " + $nextValid + " = false; for (var " + $idx + " = 0; " + $idx + " < " + $data + ".length; " + $idx + "++) { ";
                $it.errorPath = it.util.getPathExpr(it.errorPath, $idx, it.opts.jsonPointers, true);
                var $passData = $data + "[" + $idx + "]";
                $it.dataPathArr[$dataNxt] = $idx;
                var $code = it.validate($it);
                $it.baseId = $currentBaseId;
                if (it.util.varOccurences($code, $nextData) < 2) {
                    out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                } else {
                    out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                }
                out += " if (" + $nextValid + ") break; }  ";
                it.compositeRule = $it.compositeRule = $wasComposite;
                out += " " + $closingBraces + " if (!" + $nextValid + ") {"
            } else {
                out += " if (" + $data + ".length == 0) {"
            }
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + "contains" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should contain a valid item' "
                }
                if (it.opts.verbose) {
                    out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += " } else { ";
            if ($nonEmptySchema) {
                out += "  errors = " + $errs + "; if (vErrors !== null) { if (" + $errs + ") vErrors.length = " + $errs + "; else vErrors = null; } "
            }
            if (it.opts.allErrors) {
                out += " } "
            }
            out = it.util.cleanUpCode(out);
            return out
        }
    }, {}],
    24: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_custom(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $errorKeyword;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $errs = "errs__" + $lvl;
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $rule = this,
                $definition = "definition" + $lvl,
                $rDef = $rule.definition,
                $closingBraces = "";
            var $compile, $inline, $macro, $ruleValidate, $validateCode;
            if ($isData && $rDef.$data) {
                $validateCode = "keywordValidate" + $lvl;
                var $validateSchema = $rDef.validateSchema;
                out += " var " + $definition + " = RULES.custom['" + $keyword + "'].definition; var " + $validateCode + " = " + $definition + ".validate;"
            } else {
                $ruleValidate = it.useCustomRule($rule, $schema, it.schema, it);
                if (!$ruleValidate) return;
                $schemaValue = "validate.schema" + $schemaPath;
                $validateCode = $ruleValidate.code;
                $compile = $rDef.compile;
                $inline = $rDef.inline;
                $macro = $rDef.macro
            }
            var $ruleErrs = $validateCode + ".errors",
                $i = "i" + $lvl,
                $ruleErr = "ruleErr" + $lvl,
                $asyncKeyword = $rDef.async;
            if ($asyncKeyword && !it.async) throw new Error("async keyword in sync schema");
            if (!($inline || $macro)) {
                out += "" + $ruleErrs + " = null;"
            }
            out += "var " + $errs + " = errors;var " + $valid + ";";
            if ($isData && $rDef.$data) {
                $closingBraces += "}";
                out += " if (" + $schemaValue + " === undefined) { " + $valid + " = true; } else { ";
                if ($validateSchema) {
                    $closingBraces += "}";
                    out += " " + $valid + " = " + $definition + ".validateSchema(" + $schemaValue + "); if (" + $valid + ") { "
                }
            }
            if ($inline) {
                if ($rDef.statements) {
                    out += " " + $ruleValidate.validate + " "
                } else {
                    out += " " + $valid + " = " + $ruleValidate.validate + "; "
                }
            } else if ($macro) {
                var $it = it.util.copy(it);
                var $closingBraces = "";
                $it.level++;
                var $nextValid = "valid" + $it.level;
                $it.schema = $ruleValidate.validate;
                $it.schemaPath = "";
                var $wasComposite = it.compositeRule;
                it.compositeRule = $it.compositeRule = true;
                var $code = it.validate($it).replace(/validate\.schema/g, $validateCode);
                it.compositeRule = $it.compositeRule = $wasComposite;
                out += " " + $code
            } else {
                var $$outStack = $$outStack || [];
                $$outStack.push(out);
                out = "";
                out += "  " + $validateCode + ".call( ";
                if (it.opts.passContext) {
                    out += "this"
                } else {
                    out += "self"
                }
                if ($compile || $rDef.schema === false) {
                    out += " , " + $data + " "
                } else {
                    out += " , " + $schemaValue + " , " + $data + " , validate.schema" + it.schemaPath + " "
                }
                out += " , (dataPath || '')";
                if (it.errorPath != '""') {
                    out += " + " + it.errorPath
                }
                var $parentData = $dataLvl ? "data" + ($dataLvl - 1 || "") : "parentData",
                    $parentDataProperty = $dataLvl ? it.dataPathArr[$dataLvl] : "parentDataProperty";
                out += " , " + $parentData + " , " + $parentDataProperty + " , rootData )  ";
                var def_callRuleValidate = out;
                out = $$outStack.pop();
                if ($rDef.errors === false) {
                    out += " " + $valid + " = ";
                    if ($asyncKeyword) {
                        out += "" + it.yieldAwait
                    }
                    out += "" + def_callRuleValidate + "; "
                } else {
                    if ($asyncKeyword) {
                        $ruleErrs = "customErrors" + $lvl;
                        out += " var " + $ruleErrs + " = null; try { " + $valid + " = " + it.yieldAwait + def_callRuleValidate + "; } catch (e) { " + $valid + " = false; if (e instanceof ValidationError) " + $ruleErrs + " = e.errors; else throw e; } "
                    } else {
                        out += " " + $ruleErrs + " = null; " + $valid + " = " + def_callRuleValidate + "; "
                    }
                }
            }
            if ($rDef.modifying) {
                out += " if (" + $parentData + ") " + $data + " = " + $parentData + "[" + $parentDataProperty + "];"
            }
            out += "" + $closingBraces;
            if ($rDef.valid) {
                if ($breakOnError) {
                    out += " if (true) { "
                }
            } else {
                out += " if ( ";
                if ($rDef.valid === undefined) {
                    out += " !";
                    if ($macro) {
                        out += "" + $nextValid
                    } else {
                        out += "" + $valid
                    }
                } else {
                    out += " " + !$rDef.valid + " "
                }
                out += ") { ";
                $errorKeyword = $rule.keyword;
                var $$outStack = $$outStack || [];
                $$outStack.push(out);
                out = "";
                var $$outStack = $$outStack || [];
                $$outStack.push(out);
                out = "";
                if (it.createErrors !== false) {
                    out += " { keyword: '" + ($errorKeyword || "custom") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { keyword: '" + $rule.keyword + "' } ";
                    if (it.opts.messages !== false) {
                        out += " , message: 'should pass \"" + $rule.keyword + "\" keyword validation' "
                    }
                    if (it.opts.verbose) {
                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                    }
                    out += " } "
                } else {
                    out += " {} "
                }
                var __err = out;
                out = $$outStack.pop();
                if (!it.compositeRule && $breakOnError) {
                    if (it.async) {
                        out += " throw new ValidationError([" + __err + "]); "
                    } else {
                        out += " validate.errors = [" + __err + "]; return false; "
                    }
                } else {
                    out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                }
                var def_customError = out;
                out = $$outStack.pop();
                if ($inline) {
                    if ($rDef.errors) {
                        if ($rDef.errors != "full") {
                            out += "  for (var " + $i + "=" + $errs + "; " + $i + "<errors; " + $i + "++) { var " + $ruleErr + " = vErrors[" + $i + "]; if (" + $ruleErr + ".dataPath === undefined) " + $ruleErr + ".dataPath = (dataPath || '') + " + it.errorPath + "; if (" + $ruleErr + ".schemaPath === undefined) { " + $ruleErr + '.schemaPath = "' + $errSchemaPath + '"; } ';
                            if (it.opts.verbose) {
                                out += " " + $ruleErr + ".schema = " + $schemaValue + "; " + $ruleErr + ".data = " + $data + "; "
                            }
                            out += " } "
                        }
                    } else {
                        if ($rDef.errors === false) {
                            out += " " + def_customError + " "
                        } else {
                            out += " if (" + $errs + " == errors) { " + def_customError + " } else {  for (var " + $i + "=" + $errs + "; " + $i + "<errors; " + $i + "++) { var " + $ruleErr + " = vErrors[" + $i + "]; if (" + $ruleErr + ".dataPath === undefined) " + $ruleErr + ".dataPath = (dataPath || '') + " + it.errorPath + "; if (" + $ruleErr + ".schemaPath === undefined) { " + $ruleErr + '.schemaPath = "' + $errSchemaPath + '"; } ';
                            if (it.opts.verbose) {
                                out += " " + $ruleErr + ".schema = " + $schemaValue + "; " + $ruleErr + ".data = " + $data + "; "
                            }
                            out += " } } "
                        }
                    }
                } else if ($macro) {
                    out += "   var err =   ";
                    if (it.createErrors !== false) {
                        out += " { keyword: '" + ($errorKeyword || "custom") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { keyword: '" + $rule.keyword + "' } ";
                        if (it.opts.messages !== false) {
                            out += " , message: 'should pass \"" + $rule.keyword + "\" keyword validation' "
                        }
                        if (it.opts.verbose) {
                            out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                        }
                        out += " } "
                    } else {
                        out += " {} "
                    }
                    out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; ";
                    if (!it.compositeRule && $breakOnError) {
                        if (it.async) {
                            out += " throw new ValidationError(vErrors); "
                        } else {
                            out += " validate.errors = vErrors; return false; "
                        }
                    }
                } else {
                    if ($rDef.errors === false) {
                        out += " " + def_customError + " "
                    } else {
                        out += " if (Array.isArray(" + $ruleErrs + ")) { if (vErrors === null) vErrors = " + $ruleErrs + "; else vErrors = vErrors.concat(" + $ruleErrs + "); errors = vErrors.length;  for (var " + $i + "=" + $errs + "; " + $i + "<errors; " + $i + "++) { var " + $ruleErr + " = vErrors[" + $i + "]; if (" + $ruleErr + ".dataPath === undefined) " + $ruleErr + ".dataPath = (dataPath || '') + " + it.errorPath + ";  " + $ruleErr + '.schemaPath = "' + $errSchemaPath + '";  ';
                        if (it.opts.verbose) {
                            out += " " + $ruleErr + ".schema = " + $schemaValue + "; " + $ruleErr + ".data = " + $data + "; "
                        }
                        out += " } } else { " + def_customError + " } "
                    }
                }
                out += " } ";
                if ($breakOnError) {
                    out += " else { "
                }
            }
            return out
        }
    }, {}],
    25: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_dependencies(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            var $schemaDeps = {},
                $propertyDeps = {},
                $ownProperties = it.opts.ownProperties;
            for ($property in $schema) {
                var $sch = $schema[$property];
                var $deps = Array.isArray($sch) ? $propertyDeps : $schemaDeps;
                $deps[$property] = $sch
            }
            out += "var " + $errs + " = errors;";
            var $currentErrorPath = it.errorPath;
            out += "var missing" + $lvl + ";";
            for (var $property in $propertyDeps) {
                $deps = $propertyDeps[$property];
                if ($deps.length) {
                    out += " if ( " + $data + it.util.getProperty($property) + " !== undefined ";
                    if ($ownProperties) {
                        out += " && Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($property) + "') "
                    }
                    if ($breakOnError) {
                        out += " && ( ";
                        var arr1 = $deps;
                        if (arr1) {
                            var $propertyKey, $i = -1,
                                l1 = arr1.length - 1;
                            while ($i < l1) {
                                $propertyKey = arr1[$i += 1];
                                if ($i) {
                                    out += " || "
                                }
                                var $prop = it.util.getProperty($propertyKey),
                                    $useData = $data + $prop;
                                out += " ( ( " + $useData + " === undefined ";
                                if ($ownProperties) {
                                    out += " || ! Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($propertyKey) + "') "
                                }
                                out += ") && (missing" + $lvl + " = " + it.util.toQuotedString(it.opts.jsonPointers ? $propertyKey : $prop) + ") ) "
                            }
                        }
                        out += ")) {  ";
                        var $propertyPath = "missing" + $lvl,
                            $missingProperty = "' + " + $propertyPath + " + '";
                        if (it.opts._errorDataPathProperty) {
                            it.errorPath = it.opts.jsonPointers ? it.util.getPathExpr($currentErrorPath, $propertyPath, true) : $currentErrorPath + " + " + $propertyPath
                        }
                        var $$outStack = $$outStack || [];
                        $$outStack.push(out);
                        out = "";
                        if (it.createErrors !== false) {
                            out += " { keyword: '" + "dependencies" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { property: '" + it.util.escapeQuotes($property) + "', missingProperty: '" + $missingProperty + "', depsCount: " + $deps.length + ", deps: '" + it.util.escapeQuotes($deps.length == 1 ? $deps[0] : $deps.join(", ")) + "' } ";
                            if (it.opts.messages !== false) {
                                out += " , message: 'should have ";
                                if ($deps.length == 1) {
                                    out += "property " + it.util.escapeQuotes($deps[0])
                                } else {
                                    out += "properties " + it.util.escapeQuotes($deps.join(", "))
                                }
                                out += " when property " + it.util.escapeQuotes($property) + " is present' "
                            }
                            if (it.opts.verbose) {
                                out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                            }
                            out += " } "
                        } else {
                            out += " {} "
                        }
                        var __err = out;
                        out = $$outStack.pop();
                        if (!it.compositeRule && $breakOnError) {
                            if (it.async) {
                                out += " throw new ValidationError([" + __err + "]); "
                            } else {
                                out += " validate.errors = [" + __err + "]; return false; "
                            }
                        } else {
                            out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                        }
                    } else {
                        out += " ) { ";
                        var arr2 = $deps;
                        if (arr2) {
                            var $propertyKey, i2 = -1,
                                l2 = arr2.length - 1;
                            while (i2 < l2) {
                                $propertyKey = arr2[i2 += 1];
                                var $prop = it.util.getProperty($propertyKey),
                                    $missingProperty = it.util.escapeQuotes($propertyKey),
                                    $useData = $data + $prop;
                                if (it.opts._errorDataPathProperty) {
                                    it.errorPath = it.util.getPath($currentErrorPath, $propertyKey, it.opts.jsonPointers)
                                }
                                out += " if ( " + $useData + " === undefined ";
                                if ($ownProperties) {
                                    out += " || ! Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($propertyKey) + "') "
                                }
                                out += ") {  var err =   ";
                                if (it.createErrors !== false) {
                                    out += " { keyword: '" + "dependencies" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { property: '" + it.util.escapeQuotes($property) + "', missingProperty: '" + $missingProperty + "', depsCount: " + $deps.length + ", deps: '" + it.util.escapeQuotes($deps.length == 1 ? $deps[0] : $deps.join(", ")) + "' } ";
                                    if (it.opts.messages !== false) {
                                        out += " , message: 'should have ";
                                        if ($deps.length == 1) {
                                            out += "property " + it.util.escapeQuotes($deps[0])
                                        } else {
                                            out += "properties " + it.util.escapeQuotes($deps.join(", "))
                                        }
                                        out += " when property " + it.util.escapeQuotes($property) + " is present' "
                                    }
                                    if (it.opts.verbose) {
                                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                    }
                                    out += " } "
                                } else {
                                    out += " {} "
                                }
                                out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; } "
                            }
                        }
                    }
                    out += " }   ";
                    if ($breakOnError) {
                        $closingBraces += "}";
                        out += " else { "
                    }
                }
            }
            it.errorPath = $currentErrorPath;
            var $currentBaseId = $it.baseId;
            for (var $property in $schemaDeps) {
                var $sch = $schemaDeps[$property];
                if (it.util.schemaHasRules($sch, it.RULES.all)) {
                    out += " " + $nextValid + " = true; if ( " + $data + it.util.getProperty($property) + " !== undefined ";
                    if ($ownProperties) {
                        out += " && Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($property) + "') "
                    }
                    out += ") { ";
                    $it.schema = $sch;
                    $it.schemaPath = $schemaPath + it.util.getProperty($property);
                    $it.errSchemaPath = $errSchemaPath + "/" + it.util.escapeFragment($property);
                    out += "  " + it.validate($it) + " ";
                    $it.baseId = $currentBaseId;
                    out += " }  ";
                    if ($breakOnError) {
                        out += " if (" + $nextValid + ") { ";
                        $closingBraces += "}"
                    }
                }
            }
            if ($breakOnError) {
                out += "   " + $closingBraces + " if (" + $errs + " == errors) {"
            }
            out = it.util.cleanUpCode(out);
            return out
        }
    }, {}],
    26: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_enum(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $i = "i" + $lvl,
                $vSchema = "schema" + $lvl;
            if (!$isData) {
                out += " var " + $vSchema + " = validate.schema" + $schemaPath + ";"
            }
            out += "var " + $valid + ";";
            if ($isData) {
                out += " if (schema" + $lvl + " === undefined) " + $valid + " = true; else if (!Array.isArray(schema" + $lvl + ")) " + $valid + " = false; else {"
            }
            out += "" + $valid + " = false;for (var " + $i + "=0; " + $i + "<" + $vSchema + ".length; " + $i + "++) if (equal(" + $data + ", " + $vSchema + "[" + $i + "])) { " + $valid + " = true; break; }";
            if ($isData) {
                out += "  }  "
            }
            out += " if (!" + $valid + ") {   ";
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + "enum" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { allowedValues: schema" + $lvl + " } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should be equal to one of the allowed values' "
                }
                if (it.opts.verbose) {
                    out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += " }";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    27: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_format(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            if (it.opts.format === false) {
                if ($breakOnError) {
                    out += " if (true) { "
                }
                return out
            }
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $unknownFormats = it.opts.unknownFormats,
                $allowUnknown = Array.isArray($unknownFormats);
            if ($isData) {
                var $format = "format" + $lvl,
                    $isObject = "isObject" + $lvl,
                    $formatType = "formatType" + $lvl;
                out += " var " + $format + " = formats[" + $schemaValue + "]; var " + $isObject + " = typeof " + $format + " == 'object' && !(" + $format + " instanceof RegExp) && " + $format + ".validate; var " + $formatType + " = " + $isObject + " && " + $format + ".type || 'string'; if (" + $isObject + ") { ";
                if (it.async) {
                    out += " var async" + $lvl + " = " + $format + ".async; "
                }
                out += " " + $format + " = " + $format + ".validate; } if (  ";
                if ($isData) {
                    out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'string') || "
                }
                out += " (";
                if ($unknownFormats != "ignore") {
                    out += " (" + $schemaValue + " && !" + $format + " ";
                    if ($allowUnknown) {
                        out += " && self._opts.unknownFormats.indexOf(" + $schemaValue + ") == -1 "
                    }
                    out += ") || "
                }
                out += " (" + $format + " && " + $formatType + " == '" + $ruleType + "' && !(typeof " + $format + " == 'function' ? ";
                if (it.async) {
                    out += " (async" + $lvl + " ? " + it.yieldAwait + " " + $format + "(" + $data + ") : " + $format + "(" + $data + ")) "
                } else {
                    out += " " + $format + "(" + $data + ") "
                }
                out += " : " + $format + ".test(" + $data + "))))) {"
            } else {
                var $format = it.formats[$schema];
                if (!$format) {
                    if ($unknownFormats == "ignore") {
                        it.logger.warn('unknown format "' + $schema + '" ignored in schema at path "' + it.errSchemaPath + '"');
                        if ($breakOnError) {
                            out += " if (true) { "
                        }
                        return out
                    } else if ($allowUnknown && $unknownFormats.indexOf($schema) >= 0) {
                        if ($breakOnError) {
                            out += " if (true) { "
                        }
                        return out
                    } else {
                        throw new Error('unknown format "' + $schema + '" is used in schema at path "' + it.errSchemaPath + '"')
                    }
                }
                var $isObject = typeof $format == "object" && !($format instanceof RegExp) && $format.validate;
                var $formatType = $isObject && $format.type || "string";
                if ($isObject) {
                    var $async = $format.async === true;
                    $format = $format.validate
                }
                if ($formatType != $ruleType) {
                    if ($breakOnError) {
                        out += " if (true) { "
                    }
                    return out
                }
                if ($async) {
                    if (!it.async) throw new Error("async format in sync schema");
                    var $formatRef = "formats" + it.util.getProperty($schema) + ".validate";
                    out += " if (!(" + it.yieldAwait + " " + $formatRef + "(" + $data + "))) { "
                } else {
                    out += " if (! ";
                    var $formatRef = "formats" + it.util.getProperty($schema);
                    if ($isObject) $formatRef += ".validate";
                    if (typeof $format == "function") {
                        out += " " + $formatRef + "(" + $data + ") "
                    } else {
                        out += " " + $formatRef + ".test(" + $data + ") "
                    }
                    out += ") { "
                }
            }
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + "format" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { format:  ";
                if ($isData) {
                    out += "" + $schemaValue
                } else {
                    out += "" + it.util.toQuotedString($schema)
                }
                out += "  } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should match format \"";
                    if ($isData) {
                        out += "' + " + $schemaValue + " + '"
                    } else {
                        out += "" + it.util.escapeQuotes($schema)
                    }
                    out += "\"' "
                }
                if (it.opts.verbose) {
                    out += " , schema:  ";
                    if ($isData) {
                        out += "validate.schema" + $schemaPath
                    } else {
                        out += "" + it.util.toQuotedString($schema)
                    }
                    out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += " } ";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    28: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_items(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            var $idx = "i" + $lvl,
                $dataNxt = $it.dataLevel = it.dataLevel + 1,
                $nextData = "data" + $dataNxt,
                $currentBaseId = it.baseId;
            out += "var " + $errs + " = errors;var " + $valid + ";";
            if (Array.isArray($schema)) {
                var $additionalItems = it.schema.additionalItems;
                if ($additionalItems === false) {
                    out += " " + $valid + " = " + $data + ".length <= " + $schema.length + "; ";
                    var $currErrSchemaPath = $errSchemaPath;
                    $errSchemaPath = it.errSchemaPath + "/additionalItems";
                    out += "  if (!" + $valid + ") {   ";
                    var $$outStack = $$outStack || [];
                    $$outStack.push(out);
                    out = "";
                    if (it.createErrors !== false) {
                        out += " { keyword: '" + "additionalItems" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { limit: " + $schema.length + " } ";
                        if (it.opts.messages !== false) {
                            out += " , message: 'should NOT have more than " + $schema.length + " items' "
                        }
                        if (it.opts.verbose) {
                            out += " , schema: false , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                        }
                        out += " } "
                    } else {
                        out += " {} "
                    }
                    var __err = out;
                    out = $$outStack.pop();
                    if (!it.compositeRule && $breakOnError) {
                        if (it.async) {
                            out += " throw new ValidationError([" + __err + "]); "
                        } else {
                            out += " validate.errors = [" + __err + "]; return false; "
                        }
                    } else {
                        out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                    }
                    out += " } ";
                    $errSchemaPath = $currErrSchemaPath;
                    if ($breakOnError) {
                        $closingBraces += "}";
                        out += " else { "
                    }
                }
                var arr1 = $schema;
                if (arr1) {
                    var $sch, $i = -1,
                        l1 = arr1.length - 1;
                    while ($i < l1) {
                        $sch = arr1[$i += 1];
                        if (it.util.schemaHasRules($sch, it.RULES.all)) {
                            out += " " + $nextValid + " = true; if (" + $data + ".length > " + $i + ") { ";
                            var $passData = $data + "[" + $i + "]";
                            $it.schema = $sch;
                            $it.schemaPath = $schemaPath + "[" + $i + "]";
                            $it.errSchemaPath = $errSchemaPath + "/" + $i;
                            $it.errorPath = it.util.getPathExpr(it.errorPath, $i, it.opts.jsonPointers, true);
                            $it.dataPathArr[$dataNxt] = $i;
                            var $code = it.validate($it);
                            $it.baseId = $currentBaseId;
                            if (it.util.varOccurences($code, $nextData) < 2) {
                                out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                            } else {
                                out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                            }
                            out += " }  ";
                            if ($breakOnError) {
                                out += " if (" + $nextValid + ") { ";
                                $closingBraces += "}"
                            }
                        }
                    }
                }
                if (typeof $additionalItems == "object" && it.util.schemaHasRules($additionalItems, it.RULES.all)) {
                    $it.schema = $additionalItems;
                    $it.schemaPath = it.schemaPath + ".additionalItems";
                    $it.errSchemaPath = it.errSchemaPath + "/additionalItems";
                    out += " " + $nextValid + " = true; if (" + $data + ".length > " + $schema.length + ") {  for (var " + $idx + " = " + $schema.length + "; " + $idx + " < " + $data + ".length; " + $idx + "++) { ";
                    $it.errorPath = it.util.getPathExpr(it.errorPath, $idx, it.opts.jsonPointers, true);
                    var $passData = $data + "[" + $idx + "]";
                    $it.dataPathArr[$dataNxt] = $idx;
                    var $code = it.validate($it);
                    $it.baseId = $currentBaseId;
                    if (it.util.varOccurences($code, $nextData) < 2) {
                        out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                    } else {
                        out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                    }
                    if ($breakOnError) {
                        out += " if (!" + $nextValid + ") break; "
                    }
                    out += " } }  ";
                    if ($breakOnError) {
                        out += " if (" + $nextValid + ") { ";
                        $closingBraces += "}"
                    }
                }
            } else if (it.util.schemaHasRules($schema, it.RULES.all)) {
                $it.schema = $schema;
                $it.schemaPath = $schemaPath;
                $it.errSchemaPath = $errSchemaPath;
                out += "  for (var " + $idx + " = " + 0 + "; " + $idx + " < " + $data + ".length; " + $idx + "++) { ";
                $it.errorPath = it.util.getPathExpr(it.errorPath, $idx, it.opts.jsonPointers, true);
                var $passData = $data + "[" + $idx + "]";
                $it.dataPathArr[$dataNxt] = $idx;
                var $code = it.validate($it);
                $it.baseId = $currentBaseId;
                if (it.util.varOccurences($code, $nextData) < 2) {
                    out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                } else {
                    out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                }
                if ($breakOnError) {
                    out += " if (!" + $nextValid + ") break; "
                }
                out += " }"
            }
            if ($breakOnError) {
                out += " " + $closingBraces + " if (" + $errs + " == errors) {"
            }
            out = it.util.cleanUpCode(out);
            return out
        }
    }, {}],
    29: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_multipleOf(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            out += "var division" + $lvl + ";if (";
            if ($isData) {
                out += " " + $schemaValue + " !== undefined && ( typeof " + $schemaValue + " != 'number' || "
            }
            out += " (division" + $lvl + " = " + $data + " / " + $schemaValue + ", ";
            if (it.opts.multipleOfPrecision) {
                out += " Math.abs(Math.round(division" + $lvl + ") - division" + $lvl + ") > 1e-" + it.opts.multipleOfPrecision + " "
            } else {
                out += " division" + $lvl + " !== parseInt(division" + $lvl + ") "
            }
            out += " ) ";
            if ($isData) {
                out += "  )  "
            }
            out += " ) {   ";
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + "multipleOf" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { multipleOf: " + $schemaValue + " } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should be multiple of ";
                    if ($isData) {
                        out += "' + " + $schemaValue
                    } else {
                        out += "" + $schemaValue + "'"
                    }
                }
                if (it.opts.verbose) {
                    out += " , schema:  ";
                    if ($isData) {
                        out += "validate.schema" + $schemaPath
                    } else {
                        out += "" + $schema
                    }
                    out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += "} ";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    30: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_not(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            $it.level++;
            var $nextValid = "valid" + $it.level;
            if (it.util.schemaHasRules($schema, it.RULES.all)) {
                $it.schema = $schema;
                $it.schemaPath = $schemaPath;
                $it.errSchemaPath = $errSchemaPath;
                out += " var " + $errs + " = errors;  ";
                var $wasComposite = it.compositeRule;
                it.compositeRule = $it.compositeRule = true;
                $it.createErrors = false;
                var $allErrorsOption;
                if ($it.opts.allErrors) {
                    $allErrorsOption = $it.opts.allErrors;
                    $it.opts.allErrors = false
                }
                out += " " + it.validate($it) + " ";
                $it.createErrors = true;
                if ($allErrorsOption) $it.opts.allErrors = $allErrorsOption;
                it.compositeRule = $it.compositeRule = $wasComposite;
                out += " if (" + $nextValid + ") {   ";
                var $$outStack = $$outStack || [];
                $$outStack.push(out);
                out = "";
                if (it.createErrors !== false) {
                    out += " { keyword: '" + "not" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                    if (it.opts.messages !== false) {
                        out += " , message: 'should NOT be valid' "
                    }
                    if (it.opts.verbose) {
                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                    }
                    out += " } "
                } else {
                    out += " {} "
                }
                var __err = out;
                out = $$outStack.pop();
                if (!it.compositeRule && $breakOnError) {
                    if (it.async) {
                        out += " throw new ValidationError([" + __err + "]); "
                    } else {
                        out += " validate.errors = [" + __err + "]; return false; "
                    }
                } else {
                    out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                }
                out += " } else {  errors = " + $errs + "; if (vErrors !== null) { if (" + $errs + ") vErrors.length = " + $errs + "; else vErrors = null; } ";
                if (it.opts.allErrors) {
                    out += " } "
                }
            } else {
                out += "  var err =   ";
                if (it.createErrors !== false) {
                    out += " { keyword: '" + "not" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                    if (it.opts.messages !== false) {
                        out += " , message: 'should NOT be valid' "
                    }
                    if (it.opts.verbose) {
                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                    }
                    out += " } "
                } else {
                    out += " {} "
                }
                out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; ";
                if ($breakOnError) {
                    out += " if (false) { "
                }
            }
            return out
        }
    }, {}],
    31: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_oneOf(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            out += "var " + $errs + " = errors;var prevValid" + $lvl + " = false;var " + $valid + " = false;";
            var $currentBaseId = $it.baseId;
            var $wasComposite = it.compositeRule;
            it.compositeRule = $it.compositeRule = true;
            var arr1 = $schema;
            if (arr1) {
                var $sch, $i = -1,
                    l1 = arr1.length - 1;
                while ($i < l1) {
                    $sch = arr1[$i += 1];
                    if (it.util.schemaHasRules($sch, it.RULES.all)) {
                        $it.schema = $sch;
                        $it.schemaPath = $schemaPath + "[" + $i + "]";
                        $it.errSchemaPath = $errSchemaPath + "/" + $i;
                        out += "  " + it.validate($it) + " ";
                        $it.baseId = $currentBaseId
                    } else {
                        out += " var " + $nextValid + " = true; "
                    }
                    if ($i) {
                        out += " if (" + $nextValid + " && prevValid" + $lvl + ") " + $valid + " = false; else { ";
                        $closingBraces += "}"
                    }
                    out += " if (" + $nextValid + ") " + $valid + " = prevValid" + $lvl + " = true;"
                }
            }
            it.compositeRule = $it.compositeRule = $wasComposite;
            out += "" + $closingBraces + "if (!" + $valid + ") {   var err =   ";
            if (it.createErrors !== false) {
                out += " { keyword: '" + "oneOf" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should match exactly one schema in oneOf' "
                }
                if (it.opts.verbose) {
                    out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; ";
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError(vErrors); "
                } else {
                    out += " validate.errors = vErrors; return false; "
                }
            }
            out += "} else {  errors = " + $errs + "; if (vErrors !== null) { if (" + $errs + ") vErrors.length = " + $errs + "; else vErrors = null; }";
            if (it.opts.allErrors) {
                out += " } "
            }
            return out
        }
    }, {}],
    32: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_pattern(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $regexp = $isData ? "(new RegExp(" + $schemaValue + "))" : it.usePattern($schema);
            out += "if ( ";
            if ($isData) {
                out += " (" + $schemaValue + " !== undefined && typeof " + $schemaValue + " != 'string') || "
            }
            out += " !" + $regexp + ".test(" + $data + ") ) {   ";
            var $$outStack = $$outStack || [];
            $$outStack.push(out);
            out = "";
            if (it.createErrors !== false) {
                out += " { keyword: '" + "pattern" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { pattern:  ";
                if ($isData) {
                    out += "" + $schemaValue
                } else {
                    out += "" + it.util.toQuotedString($schema)
                }
                out += "  } ";
                if (it.opts.messages !== false) {
                    out += " , message: 'should match pattern \"";
                    if ($isData) {
                        out += "' + " + $schemaValue + " + '"
                    } else {
                        out += "" + it.util.escapeQuotes($schema)
                    }
                    out += "\"' "
                }
                if (it.opts.verbose) {
                    out += " , schema:  ";
                    if ($isData) {
                        out += "validate.schema" + $schemaPath
                    } else {
                        out += "" + it.util.toQuotedString($schema)
                    }
                    out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                }
                out += " } "
            } else {
                out += " {} "
            }
            var __err = out;
            out = $$outStack.pop();
            if (!it.compositeRule && $breakOnError) {
                if (it.async) {
                    out += " throw new ValidationError([" + __err + "]); "
                } else {
                    out += " validate.errors = [" + __err + "]; return false; "
                }
            } else {
                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
            }
            out += "} ";
            if ($breakOnError) {
                out += " else { "
            }
            return out
        }
    }, {}],
    33: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_properties(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            var $key = "key" + $lvl,
                $idx = "idx" + $lvl,
                $dataNxt = $it.dataLevel = it.dataLevel + 1,
                $nextData = "data" + $dataNxt,
                $dataProperties = "dataProperties" + $lvl;
            var $schemaKeys = Object.keys($schema || {}),
                $pProperties = it.schema.patternProperties || {},
                $pPropertyKeys = Object.keys($pProperties),
                $aProperties = it.schema.additionalProperties,
                $someProperties = $schemaKeys.length || $pPropertyKeys.length,
                $noAdditional = $aProperties === false,
                $additionalIsSchema = typeof $aProperties == "object" && Object.keys($aProperties).length,
                $removeAdditional = it.opts.removeAdditional,
                $checkAdditional = $noAdditional || $additionalIsSchema || $removeAdditional,
                $ownProperties = it.opts.ownProperties,
                $currentBaseId = it.baseId;
            var $required = it.schema.required;
            if ($required && !(it.opts.v5 && $required.$data) && $required.length < it.opts.loopRequired) var $requiredHash = it.util.toHash($required);
            if (it.opts.patternGroups) {
                var $pgProperties = it.schema.patternGroups || {},
                    $pgPropertyKeys = Object.keys($pgProperties)
            }
            out += "var " + $errs + " = errors;var " + $nextValid + " = true;";
            if ($ownProperties) {
                out += " var " + $dataProperties + " = undefined;"
            }
            if ($checkAdditional) {
                if ($ownProperties) {
                    out += " " + $dataProperties + " = " + $dataProperties + " || Object.keys(" + $data + "); for (var " + $idx + "=0; " + $idx + "<" + $dataProperties + ".length; " + $idx + "++) { var " + $key + " = " + $dataProperties + "[" + $idx + "]; "
                } else {
                    out += " for (var " + $key + " in " + $data + ") { "
                }
                if ($someProperties) {
                    out += " var isAdditional" + $lvl + " = !(false ";
                    if ($schemaKeys.length) {
                        if ($schemaKeys.length > 5) {
                            out += " || validate.schema" + $schemaPath + "[" + $key + "] "
                        } else {
                            var arr1 = $schemaKeys;
                            if (arr1) {
                                var $propertyKey, i1 = -1,
                                    l1 = arr1.length - 1;
                                while (i1 < l1) {
                                    $propertyKey = arr1[i1 += 1];
                                    out += " || " + $key + " == " + it.util.toQuotedString($propertyKey) + " "
                                }
                            }
                        }
                    }
                    if ($pPropertyKeys.length) {
                        var arr2 = $pPropertyKeys;
                        if (arr2) {
                            var $pProperty, $i = -1,
                                l2 = arr2.length - 1;
                            while ($i < l2) {
                                $pProperty = arr2[$i += 1];
                                out += " || " + it.usePattern($pProperty) + ".test(" + $key + ") "
                            }
                        }
                    }
                    if (it.opts.patternGroups && $pgPropertyKeys.length) {
                        var arr3 = $pgPropertyKeys;
                        if (arr3) {
                            var $pgProperty, $i = -1,
                                l3 = arr3.length - 1;
                            while ($i < l3) {
                                $pgProperty = arr3[$i += 1];
                                out += " || " + it.usePattern($pgProperty) + ".test(" + $key + ") "
                            }
                        }
                    }
                    out += " ); if (isAdditional" + $lvl + ") { "
                }
                if ($removeAdditional == "all") {
                    out += " delete " + $data + "[" + $key + "]; "
                } else {
                    var $currentErrorPath = it.errorPath;
                    var $additionalProperty = "' + " + $key + " + '";
                    if (it.opts._errorDataPathProperty) {
                        it.errorPath = it.util.getPathExpr(it.errorPath, $key, it.opts.jsonPointers)
                    }
                    if ($noAdditional) {
                        if ($removeAdditional) {
                            out += " delete " + $data + "[" + $key + "]; "
                        } else {
                            out += " " + $nextValid + " = false; ";
                            var $currErrSchemaPath = $errSchemaPath;
                            $errSchemaPath = it.errSchemaPath + "/additionalProperties";
                            var $$outStack = $$outStack || [];
                            $$outStack.push(out);
                            out = "";
                            if (it.createErrors !== false) {
                                out += " { keyword: '" + "additionalProperties" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { additionalProperty: '" + $additionalProperty + "' } ";
                                if (it.opts.messages !== false) {
                                    out += " , message: 'should NOT have additional properties' "
                                }
                                if (it.opts.verbose) {
                                    out += " , schema: false , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                }
                                out += " } "
                            } else {
                                out += " {} "
                            }
                            var __err = out;
                            out = $$outStack.pop();
                            if (!it.compositeRule && $breakOnError) {
                                if (it.async) {
                                    out += " throw new ValidationError([" + __err + "]); "
                                } else {
                                    out += " validate.errors = [" + __err + "]; return false; "
                                }
                            } else {
                                out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                            }
                            $errSchemaPath = $currErrSchemaPath;
                            if ($breakOnError) {
                                out += " break; "
                            }
                        }
                    } else if ($additionalIsSchema) {
                        if ($removeAdditional == "failing") {
                            out += " var " + $errs + " = errors;  ";
                            var $wasComposite = it.compositeRule;
                            it.compositeRule = $it.compositeRule = true;
                            $it.schema = $aProperties;
                            $it.schemaPath = it.schemaPath + ".additionalProperties";
                            $it.errSchemaPath = it.errSchemaPath + "/additionalProperties";
                            $it.errorPath = it.opts._errorDataPathProperty ? it.errorPath : it.util.getPathExpr(it.errorPath, $key, it.opts.jsonPointers);
                            var $passData = $data + "[" + $key + "]";
                            $it.dataPathArr[$dataNxt] = $key;
                            var $code = it.validate($it);
                            $it.baseId = $currentBaseId;
                            if (it.util.varOccurences($code, $nextData) < 2) {
                                out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                            } else {
                                out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                            }
                            out += " if (!" + $nextValid + ") { errors = " + $errs + "; if (validate.errors !== null) { if (errors) validate.errors.length = errors; else validate.errors = null; } delete " + $data + "[" + $key + "]; }  ";
                            it.compositeRule = $it.compositeRule = $wasComposite
                        } else {
                            $it.schema = $aProperties;
                            $it.schemaPath = it.schemaPath + ".additionalProperties";
                            $it.errSchemaPath = it.errSchemaPath + "/additionalProperties";
                            $it.errorPath = it.opts._errorDataPathProperty ? it.errorPath : it.util.getPathExpr(it.errorPath, $key, it.opts.jsonPointers);
                            var $passData = $data + "[" + $key + "]";
                            $it.dataPathArr[$dataNxt] = $key;
                            var $code = it.validate($it);
                            $it.baseId = $currentBaseId;
                            if (it.util.varOccurences($code, $nextData) < 2) {
                                out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                            } else {
                                out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                            }
                            if ($breakOnError) {
                                out += " if (!" + $nextValid + ") break; "
                            }
                        }
                    }
                    it.errorPath = $currentErrorPath
                }
                if ($someProperties) {
                    out += " } "
                }
                out += " }  ";
                if ($breakOnError) {
                    out += " if (" + $nextValid + ") { ";
                    $closingBraces += "}"
                }
            }
            var $useDefaults = it.opts.useDefaults && !it.compositeRule;
            if ($schemaKeys.length) {
                var arr4 = $schemaKeys;
                if (arr4) {
                    var $propertyKey, i4 = -1,
                        l4 = arr4.length - 1;
                    while (i4 < l4) {
                        $propertyKey = arr4[i4 += 1];
                        var $sch = $schema[$propertyKey];
                        if (it.util.schemaHasRules($sch, it.RULES.all)) {
                            var $prop = it.util.getProperty($propertyKey),
                                $passData = $data + $prop,
                                $hasDefault = $useDefaults && $sch.default !== undefined;
                            $it.schema = $sch;
                            $it.schemaPath = $schemaPath + $prop;
                            $it.errSchemaPath = $errSchemaPath + "/" + it.util.escapeFragment($propertyKey);
                            $it.errorPath = it.util.getPath(it.errorPath, $propertyKey, it.opts.jsonPointers);
                            $it.dataPathArr[$dataNxt] = it.util.toQuotedString($propertyKey);
                            var $code = it.validate($it);
                            $it.baseId = $currentBaseId;
                            if (it.util.varOccurences($code, $nextData) < 2) {
                                $code = it.util.varReplace($code, $nextData, $passData);
                                var $useData = $passData
                            } else {
                                var $useData = $nextData;
                                out += " var " + $nextData + " = " + $passData + "; "
                            }
                            if ($hasDefault) {
                                out += " " + $code + " "
                            } else {
                                if ($requiredHash && $requiredHash[$propertyKey]) {
                                    out += " if ( " + $useData + " === undefined ";
                                    if ($ownProperties) {
                                        out += " || ! Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($propertyKey) + "') "
                                    }
                                    out += ") { " + $nextValid + " = false; ";
                                    var $currentErrorPath = it.errorPath,
                                        $currErrSchemaPath = $errSchemaPath,
                                        $missingProperty = it.util.escapeQuotes($propertyKey);
                                    if (it.opts._errorDataPathProperty) {
                                        it.errorPath = it.util.getPath($currentErrorPath, $propertyKey, it.opts.jsonPointers)
                                    }
                                    $errSchemaPath = it.errSchemaPath + "/required";
                                    var $$outStack = $$outStack || [];
                                    $$outStack.push(out);
                                    out = "";
                                    if (it.createErrors !== false) {
                                        out += " { keyword: '" + "required" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { missingProperty: '" + $missingProperty + "' } ";
                                        if (it.opts.messages !== false) {
                                            out += " , message: '";
                                            if (it.opts._errorDataPathProperty) {
                                                out += "is a required property"
                                            } else {
                                                out += "should have required property \\'" + $missingProperty + "\\'"
                                            }
                                            out += "' "
                                        }
                                        if (it.opts.verbose) {
                                            out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                        }
                                        out += " } "
                                    } else {
                                        out += " {} "
                                    }
                                    var __err = out;
                                    out = $$outStack.pop();
                                    if (!it.compositeRule && $breakOnError) {
                                        if (it.async) {
                                            out += " throw new ValidationError([" + __err + "]); "
                                        } else {
                                            out += " validate.errors = [" + __err + "]; return false; "
                                        }
                                    } else {
                                        out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                                    }
                                    $errSchemaPath = $currErrSchemaPath;
                                    it.errorPath = $currentErrorPath;
                                    out += " } else { "
                                } else {
                                    if ($breakOnError) {
                                        out += " if ( " + $useData + " === undefined ";
                                        if ($ownProperties) {
                                            out += " || ! Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($propertyKey) + "') "
                                        }
                                        out += ") { " + $nextValid + " = true; } else { "
                                    } else {
                                        out += " if (" + $useData + " !== undefined ";
                                        if ($ownProperties) {
                                            out += " &&   Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($propertyKey) + "') "
                                        }
                                        out += " ) { "
                                    }
                                }
                                out += " " + $code + " } "
                            }
                        }
                        if ($breakOnError) {
                            out += " if (" + $nextValid + ") { ";
                            $closingBraces += "}"
                        }
                    }
                }
            }
            if ($pPropertyKeys.length) {
                var arr5 = $pPropertyKeys;
                if (arr5) {
                    var $pProperty, i5 = -1,
                        l5 = arr5.length - 1;
                    while (i5 < l5) {
                        $pProperty = arr5[i5 += 1];
                        var $sch = $pProperties[$pProperty];
                        if (it.util.schemaHasRules($sch, it.RULES.all)) {
                            $it.schema = $sch;
                            $it.schemaPath = it.schemaPath + ".patternProperties" + it.util.getProperty($pProperty);
                            $it.errSchemaPath = it.errSchemaPath + "/patternProperties/" + it.util.escapeFragment($pProperty);
                            if ($ownProperties) {
                                out += " " + $dataProperties + " = " + $dataProperties + " || Object.keys(" + $data + "); for (var " + $idx + "=0; " + $idx + "<" + $dataProperties + ".length; " + $idx + "++) { var " + $key + " = " + $dataProperties + "[" + $idx + "]; "
                            } else {
                                out += " for (var " + $key + " in " + $data + ") { "
                            }
                            out += " if (" + it.usePattern($pProperty) + ".test(" + $key + ")) { ";
                            $it.errorPath = it.util.getPathExpr(it.errorPath, $key, it.opts.jsonPointers);
                            var $passData = $data + "[" + $key + "]";
                            $it.dataPathArr[$dataNxt] = $key;
                            var $code = it.validate($it);
                            $it.baseId = $currentBaseId;
                            if (it.util.varOccurences($code, $nextData) < 2) {
                                out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                            } else {
                                out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                            }
                            if ($breakOnError) {
                                out += " if (!" + $nextValid + ") break; "
                            }
                            out += " } ";
                            if ($breakOnError) {
                                out += " else " + $nextValid + " = true; "
                            }
                            out += " }  ";
                            if ($breakOnError) {
                                out += " if (" + $nextValid + ") { ";
                                $closingBraces += "}"
                            }
                        }
                    }
                }
            }
            if (it.opts.patternGroups && $pgPropertyKeys.length) {
                var arr6 = $pgPropertyKeys;
                if (arr6) {
                    var $pgProperty, i6 = -1,
                        l6 = arr6.length - 1;
                    while (i6 < l6) {
                        $pgProperty = arr6[i6 += 1];
                        var $pgSchema = $pgProperties[$pgProperty],
                            $sch = $pgSchema.schema;
                        if (it.util.schemaHasRules($sch, it.RULES.all)) {
                            $it.schema = $sch;
                            $it.schemaPath = it.schemaPath + ".patternGroups" + it.util.getProperty($pgProperty) + ".schema";
                            $it.errSchemaPath = it.errSchemaPath + "/patternGroups/" + it.util.escapeFragment($pgProperty) + "/schema";
                            out += " var pgPropCount" + $lvl + " = 0;  ";
                            if ($ownProperties) {
                                out += " " + $dataProperties + " = " + $dataProperties + " || Object.keys(" + $data + "); for (var " + $idx + "=0; " + $idx + "<" + $dataProperties + ".length; " + $idx + "++) { var " + $key + " = " + $dataProperties + "[" + $idx + "]; "
                            } else {
                                out += " for (var " + $key + " in " + $data + ") { "
                            }
                            out += " if (" + it.usePattern($pgProperty) + ".test(" + $key + ")) { pgPropCount" + $lvl + "++; ";
                            $it.errorPath = it.util.getPathExpr(it.errorPath, $key, it.opts.jsonPointers);
                            var $passData = $data + "[" + $key + "]";
                            $it.dataPathArr[$dataNxt] = $key;
                            var $code = it.validate($it);
                            $it.baseId = $currentBaseId;
                            if (it.util.varOccurences($code, $nextData) < 2) {
                                out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                            } else {
                                out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                            }
                            if ($breakOnError) {
                                out += " if (!" + $nextValid + ") break; "
                            }
                            out += " } ";
                            if ($breakOnError) {
                                out += " else " + $nextValid + " = true; "
                            }
                            out += " }  ";
                            if ($breakOnError) {
                                out += " if (" + $nextValid + ") { ";
                                $closingBraces += "}"
                            }
                            var $pgMin = $pgSchema.minimum,
                                $pgMax = $pgSchema.maximum;
                            if ($pgMin !== undefined || $pgMax !== undefined) {
                                out += " var " + $valid + " = true; ";
                                var $currErrSchemaPath = $errSchemaPath;
                                if ($pgMin !== undefined) {
                                    var $limit = $pgMin,
                                        $reason = "minimum",
                                        $moreOrLess = "less";
                                    out += " " + $valid + " = pgPropCount" + $lvl + " >= " + $pgMin + "; ";
                                    $errSchemaPath = it.errSchemaPath + "/patternGroups/minimum";
                                    out += "  if (!" + $valid + ") {   ";
                                    var $$outStack = $$outStack || [];
                                    $$outStack.push(out);
                                    out = "";
                                    if (it.createErrors !== false) {
                                        out += " { keyword: '" + "patternGroups" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { reason: '" + $reason + "', limit: " + $limit + ", pattern: '" + it.util.escapeQuotes($pgProperty) + "' } ";
                                        if (it.opts.messages !== false) {
                                            out += " , message: 'should NOT have " + $moreOrLess + " than " + $limit + ' properties matching pattern "' + it.util.escapeQuotes($pgProperty) + "\"' "
                                        }
                                        if (it.opts.verbose) {
                                            out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                        }
                                        out += " } "
                                    } else {
                                        out += " {} "
                                    }
                                    var __err = out;
                                    out = $$outStack.pop();
                                    if (!it.compositeRule && $breakOnError) {
                                        if (it.async) {
                                            out += " throw new ValidationError([" + __err + "]); "
                                        } else {
                                            out += " validate.errors = [" + __err + "]; return false; "
                                        }
                                    } else {
                                        out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                                    }
                                    out += " } ";
                                    if ($pgMax !== undefined) {
                                        out += " else "
                                    }
                                }
                                if ($pgMax !== undefined) {
                                    var $limit = $pgMax,
                                        $reason = "maximum",
                                        $moreOrLess = "more";
                                    out += " " + $valid + " = pgPropCount" + $lvl + " <= " + $pgMax + "; ";
                                    $errSchemaPath = it.errSchemaPath + "/patternGroups/maximum";
                                    out += "  if (!" + $valid + ") {   ";
                                    var $$outStack = $$outStack || [];
                                    $$outStack.push(out);
                                    out = "";
                                    if (it.createErrors !== false) {
                                        out += " { keyword: '" + "patternGroups" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { reason: '" + $reason + "', limit: " + $limit + ", pattern: '" + it.util.escapeQuotes($pgProperty) + "' } ";
                                        if (it.opts.messages !== false) {
                                            out += " , message: 'should NOT have " + $moreOrLess + " than " + $limit + ' properties matching pattern "' + it.util.escapeQuotes($pgProperty) + "\"' "
                                        }
                                        if (it.opts.verbose) {
                                            out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                        }
                                        out += " } "
                                    } else {
                                        out += " {} "
                                    }
                                    var __err = out;
                                    out = $$outStack.pop();
                                    if (!it.compositeRule && $breakOnError) {
                                        if (it.async) {
                                            out += " throw new ValidationError([" + __err + "]); "
                                        } else {
                                            out += " validate.errors = [" + __err + "]; return false; "
                                        }
                                    } else {
                                        out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                                    }
                                    out += " } "
                                }
                                $errSchemaPath = $currErrSchemaPath;
                                if ($breakOnError) {
                                    out += " if (" + $valid + ") { ";
                                    $closingBraces += "}"
                                }
                            }
                        }
                    }
                }
            }
            if ($breakOnError) {
                out += " " + $closingBraces + " if (" + $errs + " == errors) {"
            }
            out = it.util.cleanUpCode(out);
            return out
        }
    }, {}],
    34: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_propertyNames(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $errs = "errs__" + $lvl;
            var $it = it.util.copy(it);
            var $closingBraces = "";
            $it.level++;
            var $nextValid = "valid" + $it.level;
            if (it.util.schemaHasRules($schema, it.RULES.all)) {
                $it.schema = $schema;
                $it.schemaPath = $schemaPath;
                $it.errSchemaPath = $errSchemaPath;
                var $key = "key" + $lvl,
                    $idx = "idx" + $lvl,
                    $i = "i" + $lvl,
                    $invalidName = "' + " + $key + " + '",
                    $dataNxt = $it.dataLevel = it.dataLevel + 1,
                    $nextData = "data" + $dataNxt,
                    $dataProperties = "dataProperties" + $lvl,
                    $ownProperties = it.opts.ownProperties,
                    $currentBaseId = it.baseId;
                out += " var " + $errs + " = errors; ";
                if ($ownProperties) {
                    out += " var " + $dataProperties + " = undefined; "
                }
                if ($ownProperties) {
                    out += " " + $dataProperties + " = " + $dataProperties + " || Object.keys(" + $data + "); for (var " + $idx + "=0; " + $idx + "<" + $dataProperties + ".length; " + $idx + "++) { var " + $key + " = " + $dataProperties + "[" + $idx + "]; "
                } else {
                    out += " for (var " + $key + " in " + $data + ") { "
                }
                out += " var startErrs" + $lvl + " = errors; ";
                var $passData = $key;
                var $wasComposite = it.compositeRule;
                it.compositeRule = $it.compositeRule = true;
                var $code = it.validate($it);
                $it.baseId = $currentBaseId;
                if (it.util.varOccurences($code, $nextData) < 2) {
                    out += " " + it.util.varReplace($code, $nextData, $passData) + " "
                } else {
                    out += " var " + $nextData + " = " + $passData + "; " + $code + " "
                }
                it.compositeRule = $it.compositeRule = $wasComposite;
                out += " if (!" + $nextValid + ") { for (var " + $i + "=startErrs" + $lvl + "; " + $i + "<errors; " + $i + "++) { vErrors[" + $i + "].propertyName = " + $key + "; }   var err =   ";
                if (it.createErrors !== false) {
                    out += " { keyword: '" + "propertyNames" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { propertyName: '" + $invalidName + "' } ";
                    if (it.opts.messages !== false) {
                        out += " , message: 'property name \\'" + $invalidName + "\\' is invalid' "
                    }
                    if (it.opts.verbose) {
                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                    }
                    out += " } "
                } else {
                    out += " {} "
                }
                out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; ";
                if (!it.compositeRule && $breakOnError) {
                    if (it.async) {
                        out += " throw new ValidationError(vErrors); "
                    } else {
                        out += " validate.errors = vErrors; return false; "
                    }
                }
                if ($breakOnError) {
                    out += " break; "
                }
                out += " } }"
            }
            if ($breakOnError) {
                out += " " + $closingBraces + " if (" + $errs + " == errors) {"
            }
            out = it.util.cleanUpCode(out);
            return out
        }
    }, {}],
    35: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_ref(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $async, $refCode;
            if ($schema == "#" || $schema == "#/") {
                if (it.isRoot) {
                    $async = it.async;
                    $refCode = "validate"
                } else {
                    $async = it.root.schema.$async === true;
                    $refCode = "root.refVal[0]"
                }
            } else {
                var $refVal = it.resolveRef(it.baseId, $schema, it.isRoot);
                if ($refVal === undefined) {
                    var $message = it.MissingRefError.message(it.baseId, $schema);
                    if (it.opts.missingRefs == "fail") {
                        it.logger.error($message);
                        var $$outStack = $$outStack || [];
                        $$outStack.push(out);
                        out = "";
                        if (it.createErrors !== false) {
                            out += " { keyword: '" + "$ref" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { ref: '" + it.util.escapeQuotes($schema) + "' } ";
                            if (it.opts.messages !== false) {
                                out += " , message: 'can\\'t resolve reference " + it.util.escapeQuotes($schema) + "' "
                            }
                            if (it.opts.verbose) {
                                out += " , schema: " + it.util.toQuotedString($schema) + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                            }
                            out += " } "
                        } else {
                            out += " {} "
                        }
                        var __err = out;
                        out = $$outStack.pop();
                        if (!it.compositeRule && $breakOnError) {
                            if (it.async) {
                                out += " throw new ValidationError([" + __err + "]); "
                            } else {
                                out += " validate.errors = [" + __err + "]; return false; "
                            }
                        } else {
                            out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                        }
                        if ($breakOnError) {
                            out += " if (false) { "
                        }
                    } else if (it.opts.missingRefs == "ignore") {
                        it.logger.warn($message);
                        if ($breakOnError) {
                            out += " if (true) { "
                        }
                    } else {
                        throw new it.MissingRefError(it.baseId, $schema, $message)
                    }
                } else if ($refVal.inline) {
                    var $it = it.util.copy(it);
                    $it.level++;
                    var $nextValid = "valid" + $it.level;
                    $it.schema = $refVal.schema;
                    $it.schemaPath = "";
                    $it.errSchemaPath = $schema;
                    var $code = it.validate($it).replace(/validate\.schema/g, $refVal.code);
                    out += " " + $code + " ";
                    if ($breakOnError) {
                        out += " if (" + $nextValid + ") { "
                    }
                } else {
                    $async = $refVal.$async === true;
                    $refCode = $refVal.code
                }
            }
            if ($refCode) {
                var $$outStack = $$outStack || [];
                $$outStack.push(out);
                out = "";
                if (it.opts.passContext) {
                    out += " " + $refCode + ".call(this, "
                } else {
                    out += " " + $refCode + "( "
                }
                out += " " + $data + ", (dataPath || '')";
                if (it.errorPath != '""') {
                    out += " + " + it.errorPath
                }
                var $parentData = $dataLvl ? "data" + ($dataLvl - 1 || "") : "parentData",
                    $parentDataProperty = $dataLvl ? it.dataPathArr[$dataLvl] : "parentDataProperty";
                out += " , " + $parentData + " , " + $parentDataProperty + ", rootData)  ";
                var __callValidate = out;
                out = $$outStack.pop();
                if ($async) {
                    if (!it.async) throw new Error("async schema referenced by sync schema");
                    if ($breakOnError) {
                        out += " var " + $valid + "; "
                    }
                    out += " try { " + it.yieldAwait + " " + __callValidate + "; ";
                    if ($breakOnError) {
                        out += " " + $valid + " = true; "
                    }
                    out += " } catch (e) { if (!(e instanceof ValidationError)) throw e; if (vErrors === null) vErrors = e.errors; else vErrors = vErrors.concat(e.errors); errors = vErrors.length; ";
                    if ($breakOnError) {
                        out += " " + $valid + " = false; "
                    }
                    out += " } ";
                    if ($breakOnError) {
                        out += " if (" + $valid + ") { "
                    }
                } else {
                    out += " if (!" + __callValidate + ") { if (vErrors === null) vErrors = " + $refCode + ".errors; else vErrors = vErrors.concat(" + $refCode + ".errors); errors = vErrors.length; } ";
                    if ($breakOnError) {
                        out += " else { "
                    }
                }
            }
            return out
        }
    }, {}],
    36: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_required(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            var $vSchema = "schema" + $lvl;
            if (!$isData) {
                if ($schema.length < it.opts.loopRequired && it.schema.properties && Object.keys(it.schema.properties).length) {
                    var $required = [];
                    var arr1 = $schema;
                    if (arr1) {
                        var $property, i1 = -1,
                            l1 = arr1.length - 1;
                        while (i1 < l1) {
                            $property = arr1[i1 += 1];
                            var $propertySch = it.schema.properties[$property];
                            if (!($propertySch && it.util.schemaHasRules($propertySch, it.RULES.all))) {
                                $required[$required.length] = $property
                            }
                        }
                    }
                } else {
                    var $required = $schema
                }
            }
            if ($isData || $required.length) {
                var $currentErrorPath = it.errorPath,
                    $loopRequired = $isData || $required.length >= it.opts.loopRequired,
                    $ownProperties = it.opts.ownProperties;
                if ($breakOnError) {
                    out += " var missing" + $lvl + "; ";
                    if ($loopRequired) {
                        if (!$isData) {
                            out += " var " + $vSchema + " = validate.schema" + $schemaPath + "; "
                        }
                        var $i = "i" + $lvl,
                            $propertyPath = "schema" + $lvl + "[" + $i + "]",
                            $missingProperty = "' + " + $propertyPath + " + '";
                        if (it.opts._errorDataPathProperty) {
                            it.errorPath = it.util.getPathExpr($currentErrorPath, $propertyPath, it.opts.jsonPointers)
                        }
                        out += " var " + $valid + " = true; ";
                        if ($isData) {
                            out += " if (schema" + $lvl + " === undefined) " + $valid + " = true; else if (!Array.isArray(schema" + $lvl + ")) " + $valid + " = false; else {"
                        }
                        out += " for (var " + $i + " = 0; " + $i + " < " + $vSchema + ".length; " + $i + "++) { " + $valid + " = " + $data + "[" + $vSchema + "[" + $i + "]] !== undefined ";
                        if ($ownProperties) {
                            out += " &&   Object.prototype.hasOwnProperty.call(" + $data + ", " + $vSchema + "[" + $i + "]) "
                        }
                        out += "; if (!" + $valid + ") break; } ";
                        if ($isData) {
                            out += "  }  "
                        }
                        out += "  if (!" + $valid + ") {   ";
                        var $$outStack = $$outStack || [];
                        $$outStack.push(out);
                        out = "";
                        if (it.createErrors !== false) {
                            out += " { keyword: '" + "required" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { missingProperty: '" + $missingProperty + "' } ";
                            if (it.opts.messages !== false) {
                                out += " , message: '";
                                if (it.opts._errorDataPathProperty) {
                                    out += "is a required property"
                                } else {
                                    out += "should have required property \\'" + $missingProperty + "\\'"
                                }
                                out += "' "
                            }
                            if (it.opts.verbose) {
                                out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                            }
                            out += " } "
                        } else {
                            out += " {} "
                        }
                        var __err = out;
                        out = $$outStack.pop();
                        if (!it.compositeRule && $breakOnError) {
                            if (it.async) {
                                out += " throw new ValidationError([" + __err + "]); "
                            } else {
                                out += " validate.errors = [" + __err + "]; return false; "
                            }
                        } else {
                            out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                        }
                        out += " } else { "
                    } else {
                        out += " if ( ";
                        var arr2 = $required;
                        if (arr2) {
                            var $propertyKey, $i = -1,
                                l2 = arr2.length - 1;
                            while ($i < l2) {
                                $propertyKey = arr2[$i += 1];
                                if ($i) {
                                    out += " || "
                                }
                                var $prop = it.util.getProperty($propertyKey),
                                    $useData = $data + $prop;
                                out += " ( ( " + $useData + " === undefined ";
                                if ($ownProperties) {
                                    out += " || ! Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($propertyKey) + "') "
                                }
                                out += ") && (missing" + $lvl + " = " + it.util.toQuotedString(it.opts.jsonPointers ? $propertyKey : $prop) + ") ) "
                            }
                        }
                        out += ") {  ";
                        var $propertyPath = "missing" + $lvl,
                            $missingProperty = "' + " + $propertyPath + " + '";
                        if (it.opts._errorDataPathProperty) {
                            it.errorPath = it.opts.jsonPointers ? it.util.getPathExpr($currentErrorPath, $propertyPath, true) : $currentErrorPath + " + " + $propertyPath
                        }
                        var $$outStack = $$outStack || [];
                        $$outStack.push(out);
                        out = "";
                        if (it.createErrors !== false) {
                            out += " { keyword: '" + "required" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { missingProperty: '" + $missingProperty + "' } ";
                            if (it.opts.messages !== false) {
                                out += " , message: '";
                                if (it.opts._errorDataPathProperty) {
                                    out += "is a required property"
                                } else {
                                    out += "should have required property \\'" + $missingProperty + "\\'"
                                }
                                out += "' "
                            }
                            if (it.opts.verbose) {
                                out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                            }
                            out += " } "
                        } else {
                            out += " {} "
                        }
                        var __err = out;
                        out = $$outStack.pop();
                        if (!it.compositeRule && $breakOnError) {
                            if (it.async) {
                                out += " throw new ValidationError([" + __err + "]); "
                            } else {
                                out += " validate.errors = [" + __err + "]; return false; "
                            }
                        } else {
                            out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                        }
                        out += " } else { "
                    }
                } else {
                    if ($loopRequired) {
                        if (!$isData) {
                            out += " var " + $vSchema + " = validate.schema" + $schemaPath + "; "
                        }
                        var $i = "i" + $lvl,
                            $propertyPath = "schema" + $lvl + "[" + $i + "]",
                            $missingProperty = "' + " + $propertyPath + " + '";
                        if (it.opts._errorDataPathProperty) {
                            it.errorPath = it.util.getPathExpr($currentErrorPath, $propertyPath, it.opts.jsonPointers)
                        }
                        if ($isData) {
                            out += " if (" + $vSchema + " && !Array.isArray(" + $vSchema + ")) {  var err =   ";
                            if (it.createErrors !== false) {
                                out += " { keyword: '" + "required" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { missingProperty: '" + $missingProperty + "' } ";
                                if (it.opts.messages !== false) {
                                    out += " , message: '";
                                    if (it.opts._errorDataPathProperty) {
                                        out += "is a required property"
                                    } else {
                                        out += "should have required property \\'" + $missingProperty + "\\'"
                                    }
                                    out += "' "
                                }
                                if (it.opts.verbose) {
                                    out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                }
                                out += " } "
                            } else {
                                out += " {} "
                            }
                            out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; } else if (" + $vSchema + " !== undefined) { "
                        }
                        out += " for (var " + $i + " = 0; " + $i + " < " + $vSchema + ".length; " + $i + "++) { if (" + $data + "[" + $vSchema + "[" + $i + "]] === undefined ";
                        if ($ownProperties) {
                            out += " || ! Object.prototype.hasOwnProperty.call(" + $data + ", " + $vSchema + "[" + $i + "]) "
                        }
                        out += ") {  var err =   ";
                        if (it.createErrors !== false) {
                            out += " { keyword: '" + "required" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { missingProperty: '" + $missingProperty + "' } ";
                            if (it.opts.messages !== false) {
                                out += " , message: '";
                                if (it.opts._errorDataPathProperty) {
                                    out += "is a required property"
                                } else {
                                    out += "should have required property \\'" + $missingProperty + "\\'"
                                }
                                out += "' "
                            }
                            if (it.opts.verbose) {
                                out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                            }
                            out += " } "
                        } else {
                            out += " {} "
                        }
                        out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; } } ";
                        if ($isData) {
                            out += "  }  "
                        }
                    } else {
                        var arr3 = $required;
                        if (arr3) {
                            var $propertyKey, i3 = -1,
                                l3 = arr3.length - 1;
                            while (i3 < l3) {
                                $propertyKey = arr3[i3 += 1];
                                var $prop = it.util.getProperty($propertyKey),
                                    $missingProperty = it.util.escapeQuotes($propertyKey),
                                    $useData = $data + $prop;
                                if (it.opts._errorDataPathProperty) {
                                    it.errorPath = it.util.getPath($currentErrorPath, $propertyKey, it.opts.jsonPointers)
                                }
                                out += " if ( " + $useData + " === undefined ";
                                if ($ownProperties) {
                                    out += " || ! Object.prototype.hasOwnProperty.call(" + $data + ", '" + it.util.escapeQuotes($propertyKey) + "') "
                                }
                                out += ") {  var err =   ";
                                if (it.createErrors !== false) {
                                    out += " { keyword: '" + "required" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { missingProperty: '" + $missingProperty + "' } ";
                                    if (it.opts.messages !== false) {
                                        out += " , message: '";
                                        if (it.opts._errorDataPathProperty) {
                                            out += "is a required property"
                                        } else {
                                            out += "should have required property \\'" + $missingProperty + "\\'"
                                        }
                                        out += "' "
                                    }
                                    if (it.opts.verbose) {
                                        out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                    }
                                    out += " } "
                                } else {
                                    out += " {} "
                                }
                                out += ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; } "
                            }
                        }
                    }
                }
                it.errorPath = $currentErrorPath
            } else if ($breakOnError) {
                out += " if (true) {"
            }
            return out
        }
    }, {}],
    37: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_uniqueItems(it, $keyword, $ruleType) {
            var out = " ";
            var $lvl = it.level;
            var $dataLvl = it.dataLevel;
            var $schema = it.schema[$keyword];
            var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
            var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
            var $breakOnError = !it.opts.allErrors;
            var $data = "data" + ($dataLvl || "");
            var $valid = "valid" + $lvl;
            var $isData = it.opts.$data && $schema && $schema.$data,
                $schemaValue;
            if ($isData) {
                out += " var schema" + $lvl + " = " + it.util.getData($schema.$data, $dataLvl, it.dataPathArr) + "; ";
                $schemaValue = "schema" + $lvl
            } else {
                $schemaValue = $schema
            }
            if (($schema || $isData) && it.opts.uniqueItems !== false) {
                if ($isData) {
                    out += " var " + $valid + "; if (" + $schemaValue + " === false || " + $schemaValue + " === undefined) " + $valid + " = true; else if (typeof " + $schemaValue + " != 'boolean') " + $valid + " = false; else { "
                }
                out += " var " + $valid + " = true; if (" + $data + ".length > 1) { var i = " + $data + ".length, j; outer: for (;i--;) { for (j = i; j--;) { if (equal(" + $data + "[i], " + $data + "[j])) { " + $valid + " = false; break outer; } } } } ";
                if ($isData) {
                    out += "  }  "
                }
                out += " if (!" + $valid + ") {   ";
                var $$outStack = $$outStack || [];
                $$outStack.push(out);
                out = "";
                if (it.createErrors !== false) {
                    out += " { keyword: '" + "uniqueItems" + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { i: i, j: j } ";
                    if (it.opts.messages !== false) {
                        out += " , message: 'should NOT have duplicate items (items ## ' + j + ' and ' + i + ' are identical)' "
                    }
                    if (it.opts.verbose) {
                        out += " , schema:  ";
                        if ($isData) {
                            out += "validate.schema" + $schemaPath
                        } else {
                            out += "" + $schema
                        }
                        out += "         , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                    }
                    out += " } "
                } else {
                    out += " {} "
                }
                var __err = out;
                out = $$outStack.pop();
                if (!it.compositeRule && $breakOnError) {
                    if (it.async) {
                        out += " throw new ValidationError([" + __err + "]); "
                    } else {
                        out += " validate.errors = [" + __err + "]; return false; "
                    }
                } else {
                    out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                }
                out += " } ";
                if ($breakOnError) {
                    out += " else { "
                }
            } else {
                if ($breakOnError) {
                    out += " if (true) { "
                }
            }
            return out
        }
    }, {}],
    38: [function (require, module, exports) {
        "use strict";
        module.exports = function generate_validate(it, $keyword, $ruleType) {
            var out = "";
            var $async = it.schema.$async === true,
                $refKeywords = it.util.schemaHasRulesExcept(it.schema, it.RULES.all, "$ref"),
                $id = it.self._getId(it.schema);
            if (it.isTop) {
                if ($async) {
                    it.async = true;
                    var $es7 = it.opts.async == "es7";
                    it.yieldAwait = $es7 ? "await" : "yield"
                }
                out += " var validate = ";
                if ($async) {
                    if ($es7) {
                        out += " (async function "
                    } else {
                        if (it.opts.async != "*") {
                            out += "co.wrap"
                        }
                        out += "(function* "
                    }
                } else {
                    out += " (function "
                }
                out += " (data, dataPath, parentData, parentDataProperty, rootData) { 'use strict'; ";
                if ($id && (it.opts.sourceCode || it.opts.processCode)) {
                    out += " " + ("/*# sourceURL=" + $id + " */") + " "
                }
            }
            if (typeof it.schema == "boolean" || !($refKeywords || it.schema.$ref)) {
                var $keyword = "false schema";
                var $lvl = it.level;
                var $dataLvl = it.dataLevel;
                var $schema = it.schema[$keyword];
                var $schemaPath = it.schemaPath + it.util.getProperty($keyword);
                var $errSchemaPath = it.errSchemaPath + "/" + $keyword;
                var $breakOnError = !it.opts.allErrors;
                var $errorKeyword;
                var $data = "data" + ($dataLvl || "");
                var $valid = "valid" + $lvl;
                if (it.schema === false) {
                    if (it.isTop) {
                        $breakOnError = true
                    } else {
                        out += " var " + $valid + " = false; "
                    }
                    var $$outStack = $$outStack || [];
                    $$outStack.push(out);
                    out = "";
                    if (it.createErrors !== false) {
                        out += " { keyword: '" + ($errorKeyword || "false schema") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: {} ";
                        if (it.opts.messages !== false) {
                            out += " , message: 'boolean schema is false' "
                        }
                        if (it.opts.verbose) {
                            out += " , schema: false , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                        }
                        out += " } "
                    } else {
                        out += " {} "
                    }
                    var __err = out;
                    out = $$outStack.pop();
                    if (!it.compositeRule && $breakOnError) {
                        if (it.async) {
                            out += " throw new ValidationError([" + __err + "]); "
                        } else {
                            out += " validate.errors = [" + __err + "]; return false; "
                        }
                    } else {
                        out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                    }
                } else {
                    if (it.isTop) {
                        if ($async) {
                            out += " return data; "
                        } else {
                            out += " validate.errors = null; return true; "
                        }
                    } else {
                        out += " var " + $valid + " = true; "
                    }
                }
                if (it.isTop) {
                    out += " }); return validate; "
                }
                return out
            }
            if (it.isTop) {
                var $top = it.isTop,
                    $lvl = it.level = 0,
                    $dataLvl = it.dataLevel = 0,
                    $data = "data";
                it.rootId = it.resolve.fullPath(it.self._getId(it.root.schema));
                it.baseId = it.baseId || it.rootId;
                delete it.isTop;
                it.dataPathArr = [undefined];
                out += " var vErrors = null; ";
                out += " var errors = 0;     ";
                out += " if (rootData === undefined) rootData = data; "
            } else {
                var $lvl = it.level,
                    $dataLvl = it.dataLevel,
                    $data = "data" + ($dataLvl || "");
                if ($id) it.baseId = it.resolve.url(it.baseId, $id);
                if ($async && !it.async) throw new Error("async schema in sync schema");
                out += " var errs_" + $lvl + " = errors;"
            }
            var $valid = "valid" + $lvl,
                $breakOnError = !it.opts.allErrors,
                $closingBraces1 = "",
                $closingBraces2 = "";
            var $errorKeyword;
            var $typeSchema = it.schema.type,
                $typeIsArray = Array.isArray($typeSchema);
            if ($typeIsArray && $typeSchema.length == 1) {
                $typeSchema = $typeSchema[0];
                $typeIsArray = false
            }
            if (it.schema.$ref && $refKeywords) {
                if (it.opts.extendRefs == "fail") {
                    throw new Error('$ref: validation keywords used in schema at path "' + it.errSchemaPath + '" (see option extendRefs)')
                } else if (it.opts.extendRefs !== true) {
                    $refKeywords = false;
                    it.logger.warn('$ref: keywords ignored in schema at path "' + it.errSchemaPath + '"')
                }
            }
            if ($typeSchema) {
                if (it.opts.coerceTypes) {
                    var $coerceToTypes = it.util.coerceToTypes(it.opts.coerceTypes, $typeSchema)
                }
                var $rulesGroup = it.RULES.types[$typeSchema];
                if ($coerceToTypes || $typeIsArray || $rulesGroup === true || $rulesGroup && !$shouldUseGroup($rulesGroup)) {
                    var $schemaPath = it.schemaPath + ".type",
                        $errSchemaPath = it.errSchemaPath + "/type";
                    var $schemaPath = it.schemaPath + ".type",
                        $errSchemaPath = it.errSchemaPath + "/type",
                        $method = $typeIsArray ? "checkDataTypes" : "checkDataType";
                    out += " if (" + it.util[$method]($typeSchema, $data, true) + ") { ";
                    if ($coerceToTypes) {
                        var $dataType = "dataType" + $lvl,
                            $coerced = "coerced" + $lvl;
                        out += " var " + $dataType + " = typeof " + $data + "; ";
                        if (it.opts.coerceTypes == "array") {
                            out += " if (" + $dataType + " == 'object' && Array.isArray(" + $data + ")) " + $dataType + " = 'array'; "
                        }
                        out += " var " + $coerced + " = undefined; ";
                        var $bracesCoercion = "";
                        var arr1 = $coerceToTypes;
                        if (arr1) {
                            var $type, $i = -1,
                                l1 = arr1.length - 1;
                            while ($i < l1) {
                                $type = arr1[$i += 1];
                                if ($i) {
                                    out += " if (" + $coerced + " === undefined) { ";
                                    $bracesCoercion += "}"
                                }
                                if (it.opts.coerceTypes == "array" && $type != "array") {
                                    out += " if (" + $dataType + " == 'array' && " + $data + ".length == 1) { " + $coerced + " = " + $data + " = " + $data + "[0]; " + $dataType + " = typeof " + $data + ";  } "
                                }
                                if ($type == "string") {
                                    out += " if (" + $dataType + " == 'number' || " + $dataType + " == 'boolean') " + $coerced + " = '' + " + $data + "; else if (" + $data + " === null) " + $coerced + " = ''; "
                                } else if ($type == "number" || $type == "integer") {
                                    out += " if (" + $dataType + " == 'boolean' || " + $data + " === null || (" + $dataType + " == 'string' && " + $data + " && " + $data + " == +" + $data + " ";
                                    if ($type == "integer") {
                                        out += " && !(" + $data + " % 1)"
                                    }
                                    out += ")) " + $coerced + " = +" + $data + "; "
                                } else if ($type == "boolean") {
                                    out += " if (" + $data + " === 'false' || " + $data + " === 0 || " + $data + " === null) " + $coerced + " = false; else if (" + $data + " === 'true' || " + $data + " === 1) " + $coerced + " = true; "
                                } else if ($type == "null") {
                                    out += " if (" + $data + " === '' || " + $data + " === 0 || " + $data + " === false) " + $coerced + " = null; "
                                } else if (it.opts.coerceTypes == "array" && $type == "array") {
                                    out += " if (" + $dataType + " == 'string' || " + $dataType + " == 'number' || " + $dataType + " == 'boolean' || " + $data + " == null) " + $coerced + " = [" + $data + "]; "
                                }
                            }
                        }
                        out += " " + $bracesCoercion + " if (" + $coerced + " === undefined) {   ";
                        var $$outStack = $$outStack || [];
                        $$outStack.push(out);
                        out = "";
                        if (it.createErrors !== false) {
                            out += " { keyword: '" + ($errorKeyword || "type") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { type: '";
                            if ($typeIsArray) {
                                out += "" + $typeSchema.join(",")
                            } else {
                                out += "" + $typeSchema
                            }
                            out += "' } ";
                            if (it.opts.messages !== false) {
                                out += " , message: 'should be ";
                                if ($typeIsArray) {
                                    out += "" + $typeSchema.join(",")
                                } else {
                                    out += "" + $typeSchema
                                }
                                out += "' "
                            }
                            if (it.opts.verbose) {
                                out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                            }
                            out += " } "
                        } else {
                            out += " {} "
                        }
                        var __err = out;
                        out = $$outStack.pop();
                        if (!it.compositeRule && $breakOnError) {
                            if (it.async) {
                                out += " throw new ValidationError([" + __err + "]); "
                            } else {
                                out += " validate.errors = [" + __err + "]; return false; "
                            }
                        } else {
                            out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                        }
                        out += " } else {  ";
                        var $parentData = $dataLvl ? "data" + ($dataLvl - 1 || "") : "parentData",
                            $parentDataProperty = $dataLvl ? it.dataPathArr[$dataLvl] : "parentDataProperty";
                        out += " " + $data + " = " + $coerced + "; ";
                        if (!$dataLvl) {
                            out += "if (" + $parentData + " !== undefined)"
                        }
                        out += " " + $parentData + "[" + $parentDataProperty + "] = " + $coerced + "; } "
                    } else {
                        var $$outStack = $$outStack || [];
                        $$outStack.push(out);
                        out = "";
                        if (it.createErrors !== false) {
                            out += " { keyword: '" + ($errorKeyword || "type") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { type: '";
                            if ($typeIsArray) {
                                out += "" + $typeSchema.join(",")
                            } else {
                                out += "" + $typeSchema
                            }
                            out += "' } ";
                            if (it.opts.messages !== false) {
                                out += " , message: 'should be ";
                                if ($typeIsArray) {
                                    out += "" + $typeSchema.join(",")
                                } else {
                                    out += "" + $typeSchema
                                }
                                out += "' "
                            }
                            if (it.opts.verbose) {
                                out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                            }
                            out += " } "
                        } else {
                            out += " {} "
                        }
                        var __err = out;
                        out = $$outStack.pop();
                        if (!it.compositeRule && $breakOnError) {
                            if (it.async) {
                                out += " throw new ValidationError([" + __err + "]); "
                            } else {
                                out += " validate.errors = [" + __err + "]; return false; "
                            }
                        } else {
                            out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                        }
                    }
                    out += " } "
                }
            }
            if (it.schema.$ref && !$refKeywords) {
                out += " " + it.RULES.all.$ref.code(it, "$ref") + " ";
                if ($breakOnError) {
                    out += " } if (errors === ";
                    if ($top) {
                        out += "0"
                    } else {
                        out += "errs_" + $lvl
                    }
                    out += ") { ";
                    $closingBraces2 += "}"
                }
            } else {
                if (it.opts.v5 && it.schema.patternGroups) {
                    it.logger.warn('keyword "patternGroups" is deprecated and disabled. Use option patternGroups: true to enable.')
                }
                var arr2 = it.RULES;
                if (arr2) {
                    var $rulesGroup, i2 = -1,
                        l2 = arr2.length - 1;
                    while (i2 < l2) {
                        $rulesGroup = arr2[i2 += 1];
                        if ($shouldUseGroup($rulesGroup)) {
                            if ($rulesGroup.type) {
                                out += " if (" + it.util.checkDataType($rulesGroup.type, $data) + ") { "
                            }
                            if (it.opts.useDefaults && !it.compositeRule) {
                                if ($rulesGroup.type == "object" && it.schema.properties) {
                                    var $schema = it.schema.properties,
                                        $schemaKeys = Object.keys($schema);
                                    var arr3 = $schemaKeys;
                                    if (arr3) {
                                        var $propertyKey, i3 = -1,
                                            l3 = arr3.length - 1;
                                        while (i3 < l3) {
                                            $propertyKey = arr3[i3 += 1];
                                            var $sch = $schema[$propertyKey];
                                            if ($sch.default !== undefined) {
                                                var $passData = $data + it.util.getProperty($propertyKey);
                                                out += "  if (" + $passData + " === undefined) " + $passData + " = ";
                                                if (it.opts.useDefaults == "shared") {
                                                    out += " " + it.useDefault($sch.default) + " "
                                                } else {
                                                    out += " " + JSON.stringify($sch.default) + " "
                                                }
                                                out += "; "
                                            }
                                        }
                                    }
                                } else if ($rulesGroup.type == "array" && Array.isArray(it.schema.items)) {
                                    var arr4 = it.schema.items;
                                    if (arr4) {
                                        var $sch, $i = -1,
                                            l4 = arr4.length - 1;
                                        while ($i < l4) {
                                            $sch = arr4[$i += 1];
                                            if ($sch.default !== undefined) {
                                                var $passData = $data + "[" + $i + "]";
                                                out += "  if (" + $passData + " === undefined) " + $passData + " = ";
                                                if (it.opts.useDefaults == "shared") {
                                                    out += " " + it.useDefault($sch.default) + " "
                                                } else {
                                                    out += " " + JSON.stringify($sch.default) + " "
                                                }
                                                out += "; "
                                            }
                                        }
                                    }
                                }
                            }
                            var arr5 = $rulesGroup.rules;
                            if (arr5) {
                                var $rule, i5 = -1,
                                    l5 = arr5.length - 1;
                                while (i5 < l5) {
                                    $rule = arr5[i5 += 1];
                                    if ($shouldUseRule($rule)) {
                                        var $code = $rule.code(it, $rule.keyword, $rulesGroup.type);
                                        if ($code) {
                                            out += " " + $code + " ";
                                            if ($breakOnError) {
                                                $closingBraces1 += "}"
                                            }
                                        }
                                    }
                                }
                            }
                            if ($breakOnError) {
                                out += " " + $closingBraces1 + " ";
                                $closingBraces1 = ""
                            }
                            if ($rulesGroup.type) {
                                out += " } ";
                                if ($typeSchema && $typeSchema === $rulesGroup.type && !$coerceToTypes) {
                                    out += " else { ";
                                    var $schemaPath = it.schemaPath + ".type",
                                        $errSchemaPath = it.errSchemaPath + "/type";
                                    var $$outStack = $$outStack || [];
                                    $$outStack.push(out);
                                    out = "";
                                    if (it.createErrors !== false) {
                                        out += " { keyword: '" + ($errorKeyword || "type") + "' , dataPath: (dataPath || '') + " + it.errorPath + " , schemaPath: " + it.util.toQuotedString($errSchemaPath) + " , params: { type: '";
                                        if ($typeIsArray) {
                                            out += "" + $typeSchema.join(",")
                                        } else {
                                            out += "" + $typeSchema
                                        }
                                        out += "' } ";
                                        if (it.opts.messages !== false) {
                                            out += " , message: 'should be ";
                                            if ($typeIsArray) {
                                                out += "" + $typeSchema.join(",")
                                            } else {
                                                out += "" + $typeSchema
                                            }
                                            out += "' "
                                        }
                                        if (it.opts.verbose) {
                                            out += " , schema: validate.schema" + $schemaPath + " , parentSchema: validate.schema" + it.schemaPath + " , data: " + $data + " "
                                        }
                                        out += " } "
                                    } else {
                                        out += " {} "
                                    }
                                    var __err = out;
                                    out = $$outStack.pop();
                                    if (!it.compositeRule && $breakOnError) {
                                        if (it.async) {
                                            out += " throw new ValidationError([" + __err + "]); "
                                        } else {
                                            out += " validate.errors = [" + __err + "]; return false; "
                                        }
                                    } else {
                                        out += " var err = " + __err + ";  if (vErrors === null) vErrors = [err]; else vErrors.push(err); errors++; "
                                    }
                                    out += " } "
                                }
                            }
                            if ($breakOnError) {
                                out += " if (errors === ";
                                if ($top) {
                                    out += "0"
                                } else {
                                    out += "errs_" + $lvl
                                }
                                out += ") { ";
                                $closingBraces2 += "}"
                            }
                        }
                    }
                }
            }
            if ($breakOnError) {
                out += " " + $closingBraces2 + " "
            }
            if ($top) {
                if ($async) {
                    out += " if (errors === 0) return data;           ";
                    out += " else throw new ValidationError(vErrors); "
                } else {
                    out += " validate.errors = vErrors; ";
                    out += " return errors === 0;       "
                }
                out += " }); return validate;"
            } else {
                out += " var " + $valid + " = errors === errs_" + $lvl + ";"
            }
            out = it.util.cleanUpCode(out);
            if ($top) {
                out = it.util.finalCleanUpCode(out, $async)
            }

            function $shouldUseGroup($rulesGroup) {
                var rules = $rulesGroup.rules;
                for (var i = 0; i < rules.length; i++)
                    if ($shouldUseRule(rules[i])) return true
            }

            function $shouldUseRule($rule) {
                return it.schema[$rule.keyword] !== undefined || $rule.implements && $ruleImplementsSomeKeyword($rule)
            }

            function $ruleImplementsSomeKeyword($rule) {
                var impl = $rule.implements;
                for (var i = 0; i < impl.length; i++)
                    if (it.schema[impl[i]] !== undefined) return true
            }
            return out
        }
    }, {}],
    39: [function (require, module, exports) {
        "use strict";
        var IDENTIFIER = /^[a-z_$][a-z0-9_$-]*$/i;
        var customRuleCode = require("./dotjs/custom");
        module.exports = {
            add: addKeyword,
            get: getKeyword,
            remove: removeKeyword
        };

        function addKeyword(keyword, definition) {
            var RULES = this.RULES;
            if (RULES.keywords[keyword]) throw new Error("Keyword " + keyword + " is already defined");
            if (!IDENTIFIER.test(keyword)) throw new Error("Keyword " + keyword + " is not a valid identifier");
            if (definition) {
                if (definition.macro && definition.valid !== undefined) throw new Error('"valid" option cannot be used with macro keywords');
                var dataType = definition.type;
                if (Array.isArray(dataType)) {
                    var i, len = dataType.length;
                    for (i = 0; i < len; i++) checkDataType(dataType[i]);
                    for (i = 0; i < len; i++) _addRule(keyword, dataType[i], definition)
                } else {
                    if (dataType) checkDataType(dataType);
                    _addRule(keyword, dataType, definition)
                }
                var $data = definition.$data === true && this._opts.$data;
                if ($data && !definition.validate) throw new Error('$data support: "validate" function is not defined');
                var metaSchema = definition.metaSchema;
                if (metaSchema) {
                    if ($data) {
                        metaSchema = {
                            anyOf: [metaSchema, {
                                $ref: "https://raw.githubusercontent.com/epoberezkin/ajv/master/lib/refs/$data.json#"
                            }]
                        }
                    }
                    definition.validateSchema = this.compile(metaSchema, true)
                }
            }
            RULES.keywords[keyword] = RULES.all[keyword] = true;

            function _addRule(keyword, dataType, definition) {
                var ruleGroup;
                for (var i = 0; i < RULES.length; i++) {
                    var rg = RULES[i];
                    if (rg.type == dataType) {
                        ruleGroup = rg;
                        break
                    }
                }
                if (!ruleGroup) {
                    ruleGroup = {
                        type: dataType,
                        rules: []
                    };
                    RULES.push(ruleGroup)
                }
                var rule = {
                    keyword: keyword,
                    definition: definition,
                    custom: true,
                    code: customRuleCode,
                    implements: definition.implements
                };
                ruleGroup.rules.push(rule);
                RULES.custom[keyword] = rule
            }

            function checkDataType(dataType) {
                if (!RULES.types[dataType]) throw new Error("Unknown type " + dataType)
            }
            return this
        }

        function getKeyword(keyword) {
            var rule = this.RULES.custom[keyword];
            return rule ? rule.definition : this.RULES.keywords[keyword] || false
        }

        function removeKeyword(keyword) {
            var RULES = this.RULES;
            delete RULES.keywords[keyword];
            delete RULES.all[keyword];
            delete RULES.custom[keyword];
            for (var i = 0; i < RULES.length; i++) {
                var rules = RULES[i].rules;
                for (var j = 0; j < rules.length; j++) {
                    if (rules[j].keyword == keyword) {
                        rules.splice(j, 1);
                        break
                    }
                }
            }
            return this
        }
    }, {
        "./dotjs/custom": 24
    }],
    40: [function (require, module, exports) {
        "use strict";
        var META_SCHEMA_ID = "http://json-schema.org/draft-06/schema";
        module.exports = function (ajv) {
            var defaultMeta = ajv._opts.defaultMeta;
            var metaSchemaRef = typeof defaultMeta == "string" ? {
                $ref: defaultMeta
            } : ajv.getSchema(META_SCHEMA_ID) ? {
                $ref: META_SCHEMA_ID
            } : {};
            ajv.addKeyword("patternGroups", {
                metaSchema: {
                    type: "object",
                    additionalProperties: {
                        type: "object",
                        required: ["schema"],
                        properties: {
                            maximum: {
                                type: "integer",
                                minimum: 0
                            },
                            minimum: {
                                type: "integer",
                                minimum: 0
                            },
                            schema: metaSchemaRef
                        },
                        additionalProperties: false
                    }
                }
            });
            ajv.RULES.all.properties.implements.push("patternGroups")
        }
    }, {}],
    41: [function (require, module, exports) {
        module.exports = {
            $schema: "http://json-schema.org/draft-06/schema#",
            $id: "https://raw.githubusercontent.com/epoberezkin/ajv/master/lib/refs/$data.json#",
            description: "Meta-schema for $data reference (JSON-schema extension proposal)",
            type: "object",
            required: ["$data"],
            properties: {
                $data: {
                    type: "string",
                    anyOf: [{
                        format: "relative-json-pointer"
                    }, {
                        format: "json-pointer"
                    }]
                }
            },
            additionalProperties: false
        }
    }, {}],
    42: [function (require, module, exports) {
        module.exports = {
            $schema: "http://json-schema.org/draft-06/schema#",
            $id: "http://json-schema.org/draft-06/schema#",
            title: "Core schema meta-schema",
            definitions: {
                schemaArray: {
                    type: "array",
                    minItems: 1,
                    items: {
                        $ref: "#"
                    }
                },
                nonNegativeInteger: {
                    type: "integer",
                    minimum: 0
                },
                nonNegativeIntegerDefault0: {
                    allOf: [{
                        $ref: "#/definitions/nonNegativeInteger"
                    }, {
                        default: 0
                    }]
                },
                simpleTypes: {
                    enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
                },
                stringArray: {
                    type: "array",
                    items: {
                        type: "string"
                    },
                    uniqueItems: true,
                    default: []
                }
            },
            type: ["object", "boolean"],
            properties: {
                $id: {
                    type: "string",
                    format: "uri-reference"
                },
                $schema: {
                    type: "string",
                    format: "uri"
                },
                $ref: {
                    type: "string",
                    format: "uri-reference"
                },
                title: {
                    type: "string"
                },
                description: {
                    type: "string"
                },
                default: {},
                examples: {
                    type: "array",
                    items: {}
                },
                multipleOf: {
                    type: "number",
                    exclusiveMinimum: 0
                },
                maximum: {
                    type: "number"
                },
                exclusiveMaximum: {
                    type: "number"
                },
                minimum: {
                    type: "number"
                },
                exclusiveMinimum: {
                    type: "number"
                },
                maxLength: {
                    $ref: "#/definitions/nonNegativeInteger"
                },
                minLength: {
                    $ref: "#/definitions/nonNegativeIntegerDefault0"
                },
                pattern: {
                    type: "string",
                    format: "regex"
                },
                additionalItems: {
                    $ref: "#"
                },
                items: {
                    anyOf: [{
                        $ref: "#"
                    }, {
                        $ref: "#/definitions/schemaArray"
                    }],
                    default: {}
                },
                maxItems: {
                    $ref: "#/definitions/nonNegativeInteger"
                },
                minItems: {
                    $ref: "#/definitions/nonNegativeIntegerDefault0"
                },
                uniqueItems: {
                    type: "boolean",
                    default: false
                },
                contains: {
                    $ref: "#"
                },
                maxProperties: {
                    $ref: "#/definitions/nonNegativeInteger"
                },
                minProperties: {
                    $ref: "#/definitions/nonNegativeIntegerDefault0"
                },
                required: {
                    $ref: "#/definitions/stringArray"
                },
                additionalProperties: {
                    $ref: "#"
                },
                definitions: {
                    type: "object",
                    additionalProperties: {
                        $ref: "#"
                    },
                    default: {}
                },
                properties: {
                    type: "object",
                    additionalProperties: {
                        $ref: "#"
                    },
                    default: {}
                },
                patternProperties: {
                    type: "object",
                    additionalProperties: {
                        $ref: "#"
                    },
                    default: {}
                },
                dependencies: {
                    type: "object",
                    additionalProperties: {
                        anyOf: [{
                            $ref: "#"
                        }, {
                            $ref: "#/definitions/stringArray"
                        }]
                    }
                },
                propertyNames: {
                    $ref: "#"
                },
                const: {},
                enum: {
                    type: "array",
                    minItems: 1,
                    uniqueItems: true
                },
                type: {
                    anyOf: [{
                        $ref: "#/definitions/simpleTypes"
                    }, {
                        type: "array",
                        items: {
                            $ref: "#/definitions/simpleTypes"
                        },
                        minItems: 1,
                        uniqueItems: true
                    }]
                },
                format: {
                    type: "string"
                },
                allOf: {
                    $ref: "#/definitions/schemaArray"
                },
                anyOf: {
                    $ref: "#/definitions/schemaArray"
                },
                oneOf: {
                    $ref: "#/definitions/schemaArray"
                },
                not: {
                    $ref: "#"
                }
            },
            default: {}
        }
    }, {}],
    43: [function (require, module, exports) {
        "use strict";
        exports.byteLength = byteLength;
        exports.toByteArray = toByteArray;
        exports.fromByteArray = fromByteArray;
        var lookup = [];
        var revLookup = [];
        var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
        var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (var i = 0, len = code.length; i < len; ++i) {
            lookup[i] = code[i];
            revLookup[code.charCodeAt(i)] = i
        }
        revLookup["-".charCodeAt(0)] = 62;
        revLookup["_".charCodeAt(0)] = 63;

        function placeHoldersCount(b64) {
            var len = b64.length;
            if (len % 4 > 0) {
                throw new Error("Invalid string. Length must be a multiple of 4")
            }
            return b64[len - 2] === "=" ? 2 : b64[len - 1] === "=" ? 1 : 0
        }

        function byteLength(b64) {
            return b64.length * 3 / 4 - placeHoldersCount(b64)
        }

        function toByteArray(b64) {
            var i, l, tmp, placeHolders, arr;
            var len = b64.length;
            placeHolders = placeHoldersCount(b64);
            arr = new Arr(len * 3 / 4 - placeHolders);
            l = placeHolders > 0 ? len - 4 : len;
            var L = 0;
            for (i = 0; i < l; i += 4) {
                tmp = revLookup[b64.charCodeAt(i)] << 18 | revLookup[b64.charCodeAt(i + 1)] << 12 | revLookup[b64.charCodeAt(i + 2)] << 6 | revLookup[b64.charCodeAt(i + 3)];
                arr[L++] = tmp >> 16 & 255;
                arr[L++] = tmp >> 8 & 255;
                arr[L++] = tmp & 255
            }
            if (placeHolders === 2) {
                tmp = revLookup[b64.charCodeAt(i)] << 2 | revLookup[b64.charCodeAt(i + 1)] >> 4;
                arr[L++] = tmp & 255
            } else if (placeHolders === 1) {
                tmp = revLookup[b64.charCodeAt(i)] << 10 | revLookup[b64.charCodeAt(i + 1)] << 4 | revLookup[b64.charCodeAt(i + 2)] >> 2;
                arr[L++] = tmp >> 8 & 255;
                arr[L++] = tmp & 255
            }
            return arr
        }

        function tripletToBase64(num) {
            return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63]
        }

        function encodeChunk(uint8, start, end) {
            var tmp;
            var output = [];
            for (var i = start; i < end; i += 3) {
                tmp = (uint8[i] << 16 & 16711680) + (uint8[i + 1] << 8 & 65280) + (uint8[i + 2] & 255);
                output.push(tripletToBase64(tmp))
            }
            return output.join("")
        }

        function fromByteArray(uint8) {
            var tmp;
            var len = uint8.length;
            var extraBytes = len % 3;
            var output = "";
            var parts = [];
            var maxChunkLength = 16383;
            for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
                parts.push(encodeChunk(uint8, i, i + maxChunkLength > len2 ? len2 : i + maxChunkLength))
            }
            if (extraBytes === 1) {
                tmp = uint8[len - 1];
                output += lookup[tmp >> 2];
                output += lookup[tmp << 4 & 63];
                output += "=="
            } else if (extraBytes === 2) {
                tmp = (uint8[len - 2] << 8) + uint8[len - 1];
                output += lookup[tmp >> 10];
                output += lookup[tmp >> 4 & 63];
                output += lookup[tmp << 2 & 63];
                output += "="
            }
            parts.push(output);
            return parts.join("")
        }
    }, {}],
    44: [function (require, module, exports) {
        (function (module, exports) {
            "use strict";

            function assert(val, msg) {
                if (!val) throw new Error(msg || "Assertion failed")
            }

            function inherits(ctor, superCtor) {
                ctor.super_ = superCtor;
                var TempCtor = function () {};
                TempCtor.prototype = superCtor.prototype;
                ctor.prototype = new TempCtor;
                ctor.prototype.constructor = ctor
            }

            function BN(number, base, endian) {
                if (BN.isBN(number)) {
                    return number
                }
                this.negative = 0;
                this.words = null;
                this.length = 0;
                this.red = null;
                if (number !== null) {
                    if (base === "le" || base === "be") {
                        endian = base;
                        base = 10
                    }
                    this._init(number || 0, base || 10, endian || "be")
                }
            }
            if (typeof module === "object") {
                module.exports = BN
            } else {
                exports.BN = BN
            }
            BN.BN = BN;
            BN.wordSize = 26;
            var Buffer;
            try {
                Buffer = require("buf" + "fer").Buffer
            } catch (e) {}
            BN.isBN = function isBN(num) {
                if (num instanceof BN) {
                    return true
                }
                return num !== null && typeof num === "object" && num.constructor.wordSize === BN.wordSize && Array.isArray(num.words)
            };
            BN.max = function max(left, right) {
                if (left.cmp(right) > 0) return left;
                return right
            };
            BN.min = function min(left, right) {
                if (left.cmp(right) < 0) return left;
                return right
            };
            BN.prototype._init = function init(number, base, endian) {
                if (typeof number === "number") {
                    return this._initNumber(number, base, endian)
                }
                if (typeof number === "object") {
                    return this._initArray(number, base, endian)
                }
                if (base === "hex") {
                    base = 16
                }
                assert(base === (base | 0) && base >= 2 && base <= 36);
                number = number.toString().replace(/\s+/g, "");
                var start = 0;
                if (number[0] === "-") {
                    start++
                }
                if (base === 16) {
                    this._parseHex(number, start)
                } else {
                    this._parseBase(number, base, start)
                }
                if (number[0] === "-") {
                    this.negative = 1
                }
                this.strip();
                if (endian !== "le") return;
                this._initArray(this.toArray(), base, endian)
            };
            BN.prototype._initNumber = function _initNumber(number, base, endian) {
                if (number < 0) {
                    this.negative = 1;
                    number = -number
                }
                if (number < 67108864) {
                    this.words = [number & 67108863];
                    this.length = 1
                } else if (number < 4503599627370496) {
                    this.words = [number & 67108863, number / 67108864 & 67108863];
                    this.length = 2
                } else {
                    assert(number < 9007199254740992);
                    this.words = [number & 67108863, number / 67108864 & 67108863, 1];
                    this.length = 3
                }
                if (endian !== "le") return;
                this._initArray(this.toArray(), base, endian)
            };
            BN.prototype._initArray = function _initArray(number, base, endian) {
                assert(typeof number.length === "number");
                if (number.length <= 0) {
                    this.words = [0];
                    this.length = 1;
                    return this
                }
                this.length = Math.ceil(number.length / 3);
                this.words = new Array(this.length);
                for (var i = 0; i < this.length; i++) {
                    this.words[i] = 0
                }
                var j, w;
                var off = 0;
                if (endian === "be") {
                    for (i = number.length - 1, j = 0; i >= 0; i -= 3) {
                        w = number[i] | number[i - 1] << 8 | number[i - 2] << 16;
                        this.words[j] |= w << off & 67108863;
                        this.words[j + 1] = w >>> 26 - off & 67108863;
                        off += 24;
                        if (off >= 26) {
                            off -= 26;
                            j++
                        }
                    }
                } else if (endian === "le") {
                    for (i = 0, j = 0; i < number.length; i += 3) {
                        w = number[i] | number[i + 1] << 8 | number[i + 2] << 16;
                        this.words[j] |= w << off & 67108863;
                        this.words[j + 1] = w >>> 26 - off & 67108863;
                        off += 24;
                        if (off >= 26) {
                            off -= 26;
                            j++
                        }
                    }
                }
                return this.strip()
            };

            function parseHex(str, start, end) {
                var r = 0;
                var len = Math.min(str.length, end);
                for (var i = start; i < len; i++) {
                    var c = str.charCodeAt(i) - 48;
                    r <<= 4;
                    if (c >= 49 && c <= 54) {
                        r |= c - 49 + 10
                    } else if (c >= 17 && c <= 22) {
                        r |= c - 17 + 10
                    } else {
                        r |= c & 15
                    }
                }
                return r
            }
            BN.prototype._parseHex = function _parseHex(number, start) {
                this.length = Math.ceil((number.length - start) / 6);
                this.words = new Array(this.length);
                for (var i = 0; i < this.length; i++) {
                    this.words[i] = 0
                }
                var j, w;
                var off = 0;
                for (i = number.length - 6, j = 0; i >= start; i -= 6) {
                    w = parseHex(number, i, i + 6);
                    this.words[j] |= w << off & 67108863;
                    this.words[j + 1] |= w >>> 26 - off & 4194303;
                    off += 24;
                    if (off >= 26) {
                        off -= 26;
                        j++
                    }
                }
                if (i + 6 !== start) {
                    w = parseHex(number, start, i + 6);
                    this.words[j] |= w << off & 67108863;
                    this.words[j + 1] |= w >>> 26 - off & 4194303
                }
                this.strip()
            };

            function parseBase(str, start, end, mul) {
                var r = 0;
                var len = Math.min(str.length, end);
                for (var i = start; i < len; i++) {
                    var c = str.charCodeAt(i) - 48;
                    r *= mul;
                    if (c >= 49) {
                        r += c - 49 + 10
                    } else if (c >= 17) {
                        r += c - 17 + 10
                    } else {
                        r += c
                    }
                }
                return r
            }
            BN.prototype._parseBase = function _parseBase(number, base, start) {
                this.words = [0];
                this.length = 1;
                for (var limbLen = 0, limbPow = 1; limbPow <= 67108863; limbPow *= base) {
                    limbLen++
                }
                limbLen--;
                limbPow = limbPow / base | 0;
                var total = number.length - start;
                var mod = total % limbLen;
                var end = Math.min(total, total - mod) + start;
                var word = 0;
                for (var i = start; i < end; i += limbLen) {
                    word = parseBase(number, i, i + limbLen, base);
                    this.imuln(limbPow);
                    if (this.words[0] + word < 67108864) {
                        this.words[0] += word
                    } else {
                        this._iaddn(word)
                    }
                }
                if (mod !== 0) {
                    var pow = 1;
                    word = parseBase(number, i, number.length, base);
                    for (i = 0; i < mod; i++) {
                        pow *= base
                    }
                    this.imuln(pow);
                    if (this.words[0] + word < 67108864) {
                        this.words[0] += word
                    } else {
                        this._iaddn(word)
                    }
                }
            };
            BN.prototype.copy = function copy(dest) {
                dest.words = new Array(this.length);
                for (var i = 0; i < this.length; i++) {
                    dest.words[i] = this.words[i]
                }
                dest.length = this.length;
                dest.negative = this.negative;
                dest.red = this.red
            };
            BN.prototype.clone = function clone() {
                var r = new BN(null);
                this.copy(r);
                return r
            };
            BN.prototype._expand = function _expand(size) {
                while (this.length < size) {
                    this.words[this.length++] = 0
                }
                return this
            };
            BN.prototype.strip = function strip() {
                while (this.length > 1 && this.words[this.length - 1] === 0) {
                    this.length--
                }
                return this._normSign()
            };
            BN.prototype._normSign = function _normSign() {
                if (this.length === 1 && this.words[0] === 0) {
                    this.negative = 0
                }
                return this
            };
            BN.prototype.inspect = function inspect() {
                return (this.red ? "<BN-R: " : "<BN: ") + this.toString(16) + ">"
            };
            var zeros = ["", "0", "00", "000", "0000", "00000", "000000", "0000000", "00000000", "000000000", "0000000000", "00000000000", "000000000000", "0000000000000", "00000000000000", "000000000000000", "0000000000000000", "00000000000000000", "000000000000000000", "0000000000000000000", "00000000000000000000", "000000000000000000000", "0000000000000000000000", "00000000000000000000000", "000000000000000000000000", "0000000000000000000000000"];
            var groupSizes = [0, 0, 25, 16, 12, 11, 10, 9, 8, 8, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
            var groupBases = [0, 0, 33554432, 43046721, 16777216, 48828125, 60466176, 40353607, 16777216, 43046721, 1e7, 19487171, 35831808, 62748517, 7529536, 11390625, 16777216, 24137569, 34012224, 47045881, 64e6, 4084101, 5153632, 6436343, 7962624, 9765625, 11881376, 14348907, 17210368, 20511149, 243e5, 28629151, 33554432, 39135393, 45435424, 52521875, 60466176];
            BN.prototype.toString = function toString(base, padding) {
                base = base || 10;
                padding = padding | 0 || 1;
                var out;
                if (base === 16 || base === "hex") {
                    out = "";
                    var off = 0;
                    var carry = 0;
                    for (var i = 0; i < this.length; i++) {
                        var w = this.words[i];
                        var word = ((w << off | carry) & 16777215).toString(16);
                        carry = w >>> 24 - off & 16777215;
                        if (carry !== 0 || i !== this.length - 1) {
                            out = zeros[6 - word.length] + word + out
                        } else {
                            out = word + out
                        }
                        off += 2;
                        if (off >= 26) {
                            off -= 26;
                            i--
                        }
                    }
                    if (carry !== 0) {
                        out = carry.toString(16) + out
                    }
                    while (out.length % padding !== 0) {
                        out = "0" + out
                    }
                    if (this.negative !== 0) {
                        out = "-" + out
                    }
                    return out
                }
                if (base === (base | 0) && base >= 2 && base <= 36) {
                    var groupSize = groupSizes[base];
                    var groupBase = groupBases[base];
                    out = "";
                    var c = this.clone();
                    c.negative = 0;
                    while (!c.isZero()) {
                        var r = c.modn(groupBase).toString(base);
                        c = c.idivn(groupBase);
                        if (!c.isZero()) {
                            out = zeros[groupSize - r.length] + r + out
                        } else {
                            out = r + out
                        }
                    }
                    if (this.isZero()) {
                        out = "0" + out
                    }
                    while (out.length % padding !== 0) {
                        out = "0" + out
                    }
                    if (this.negative !== 0) {
                        out = "-" + out
                    }
                    return out
                }
                assert(false, "Base should be between 2 and 36")
            };
            BN.prototype.toNumber = function toNumber() {
                var ret = this.words[0];
                if (this.length === 2) {
                    ret += this.words[1] * 67108864
                } else if (this.length === 3 && this.words[2] === 1) {
                    ret += 4503599627370496 + this.words[1] * 67108864
                } else if (this.length > 2) {
                    assert(false, "Number can only safely store up to 53 bits")
                }
                return this.negative !== 0 ? -ret : ret
            };
            BN.prototype.toJSON = function toJSON() {
                return this.toString(16)
            };
            BN.prototype.toBuffer = function toBuffer(endian, length) {
                assert(typeof Buffer !== "undefined");
                return this.toArrayLike(Buffer, endian, length)
            };
            BN.prototype.toArray = function toArray(endian, length) {
                return this.toArrayLike(Array, endian, length)
            };
            BN.prototype.toArrayLike = function toArrayLike(ArrayType, endian, length) {
                var byteLength = this.byteLength();
                var reqLength = length || Math.max(1, byteLength);
                assert(byteLength <= reqLength, "byte array longer than desired length");
                assert(reqLength > 0, "Requested array length <= 0");
                this.strip();
                var littleEndian = endian === "le";
                var res = new ArrayType(reqLength);
                var b, i;
                var q = this.clone();
                if (!littleEndian) {
                    for (i = 0; i < reqLength - byteLength; i++) {
                        res[i] = 0
                    }
                    for (i = 0; !q.isZero(); i++) {
                        b = q.andln(255);
                        q.iushrn(8);
                        res[reqLength - i - 1] = b
                    }
                } else {
                    for (i = 0; !q.isZero(); i++) {
                        b = q.andln(255);
                        q.iushrn(8);
                        res[i] = b
                    }
                    for (; i < reqLength; i++) {
                        res[i] = 0
                    }
                }
                return res
            };
            if (Math.clz32) {
                BN.prototype._countBits = function _countBits(w) {
                    return 32 - Math.clz32(w)
                }
            } else {
                BN.prototype._countBits = function _countBits(w) {
                    var t = w;
                    var r = 0;
                    if (t >= 4096) {
                        r += 13;
                        t >>>= 13
                    }
                    if (t >= 64) {
                        r += 7;
                        t >>>= 7
                    }
                    if (t >= 8) {
                        r += 4;
                        t >>>= 4
                    }
                    if (t >= 2) {
                        r += 2;
                        t >>>= 2
                    }
                    return r + t
                }
            }
            BN.prototype._zeroBits = function _zeroBits(w) {
                if (w === 0) return 26;
                var t = w;
                var r = 0;
                if ((t & 8191) === 0) {
                    r += 13;
                    t >>>= 13
                }
                if ((t & 127) === 0) {
                    r += 7;
                    t >>>= 7
                }
                if ((t & 15) === 0) {
                    r += 4;
                    t >>>= 4
                }
                if ((t & 3) === 0) {
                    r += 2;
                    t >>>= 2
                }
                if ((t & 1) === 0) {
                    r++
                }
                return r
            };
            BN.prototype.bitLength = function bitLength() {
                var w = this.words[this.length - 1];
                var hi = this._countBits(w);
                return (this.length - 1) * 26 + hi
            };

            function toBitArray(num) {
                var w = new Array(num.bitLength());
                for (var bit = 0; bit < w.length; bit++) {
                    var off = bit / 26 | 0;
                    var wbit = bit % 26;
                    w[bit] = (num.words[off] & 1 << wbit) >>> wbit
                }
                return w
            }
            BN.prototype.zeroBits = function zeroBits() {
                if (this.isZero()) return 0;
                var r = 0;
                for (var i = 0; i < this.length; i++) {
                    var b = this._zeroBits(this.words[i]);
                    r += b;
                    if (b !== 26) break
                }
                return r
            };
            BN.prototype.byteLength = function byteLength() {
                return Math.ceil(this.bitLength() / 8)
            };
            BN.prototype.toTwos = function toTwos(width) {
                if (this.negative !== 0) {
                    return this.abs().inotn(width).iaddn(1)
                }
                return this.clone()
            };
            BN.prototype.fromTwos = function fromTwos(width) {
                if (this.testn(width - 1)) {
                    return this.notn(width).iaddn(1).ineg()
                }
                return this.clone()
            };
            BN.prototype.isNeg = function isNeg() {
                return this.negative !== 0
            };
            BN.prototype.neg = function neg() {
                return this.clone().ineg()
            };
            BN.prototype.ineg = function ineg() {
                if (!this.isZero()) {
                    this.negative ^= 1
                }
                return this
            };
            BN.prototype.iuor = function iuor(num) {
                while (this.length < num.length) {
                    this.words[this.length++] = 0
                }
                for (var i = 0; i < num.length; i++) {
                    this.words[i] = this.words[i] | num.words[i]
                }
                return this.strip()
            };
            BN.prototype.ior = function ior(num) {
                assert((this.negative | num.negative) === 0);
                return this.iuor(num)
            };
            BN.prototype.or = function or(num) {
                if (this.length > num.length) return this.clone().ior(num);
                return num.clone().ior(this)
            };
            BN.prototype.uor = function uor(num) {
                if (this.length > num.length) return this.clone().iuor(num);
                return num.clone().iuor(this)
            };
            BN.prototype.iuand = function iuand(num) {
                var b;
                if (this.length > num.length) {
                    b = num
                } else {
                    b = this
                }
                for (var i = 0; i < b.length; i++) {
                    this.words[i] = this.words[i] & num.words[i]
                }
                this.length = b.length;
                return this.strip()
            };
            BN.prototype.iand = function iand(num) {
                assert((this.negative | num.negative) === 0);
                return this.iuand(num)
            };
            BN.prototype.and = function and(num) {
                if (this.length > num.length) return this.clone().iand(num);
                return num.clone().iand(this)
            };
            BN.prototype.uand = function uand(num) {
                if (this.length > num.length) return this.clone().iuand(num);
                return num.clone().iuand(this)
            };
            BN.prototype.iuxor = function iuxor(num) {
                var a;
                var b;
                if (this.length > num.length) {
                    a = this;
                    b = num
                } else {
                    a = num;
                    b = this
                }
                for (var i = 0; i < b.length; i++) {
                    this.words[i] = a.words[i] ^ b.words[i]
                }
                if (this !== a) {
                    for (; i < a.length; i++) {
                        this.words[i] = a.words[i]
                    }
                }
                this.length = a.length;
                return this.strip()
            };
            BN.prototype.ixor = function ixor(num) {
                assert((this.negative | num.negative) === 0);
                return this.iuxor(num)
            };
            BN.prototype.xor = function xor(num) {
                if (this.length > num.length) return this.clone().ixor(num);
                return num.clone().ixor(this)
            };
            BN.prototype.uxor = function uxor(num) {
                if (this.length > num.length) return this.clone().iuxor(num);
                return num.clone().iuxor(this)
            };
            BN.prototype.inotn = function inotn(width) {
                assert(typeof width === "number" && width >= 0);
                var bytesNeeded = Math.ceil(width / 26) | 0;
                var bitsLeft = width % 26;
                this._expand(bytesNeeded);
                if (bitsLeft > 0) {
                    bytesNeeded--
                }
                for (var i = 0; i < bytesNeeded; i++) {
                    this.words[i] = ~this.words[i] & 67108863
                }
                if (bitsLeft > 0) {
                    this.words[i] = ~this.words[i] & 67108863 >> 26 - bitsLeft
                }
                return this.strip()
            };
            BN.prototype.notn = function notn(width) {
                return this.clone().inotn(width)
            };
            BN.prototype.setn = function setn(bit, val) {
                assert(typeof bit === "number" && bit >= 0);
                var off = bit / 26 | 0;
                var wbit = bit % 26;
                this._expand(off + 1);
                if (val) {
                    this.words[off] = this.words[off] | 1 << wbit
                } else {
                    this.words[off] = this.words[off] & ~(1 << wbit)
                }
                return this.strip()
            };
            BN.prototype.iadd = function iadd(num) {
                var r;
                if (this.negative !== 0 && num.negative === 0) {
                    this.negative = 0;
                    r = this.isub(num);
                    this.negative ^= 1;
                    return this._normSign()
                } else if (this.negative === 0 && num.negative !== 0) {
                    num.negative = 0;
                    r = this.isub(num);
                    num.negative = 1;
                    return r._normSign()
                }
                var a, b;
                if (this.length > num.length) {
                    a = this;
                    b = num
                } else {
                    a = num;
                    b = this
                }
                var carry = 0;
                for (var i = 0; i < b.length; i++) {
                    r = (a.words[i] | 0) + (b.words[i] | 0) + carry;
                    this.words[i] = r & 67108863;
                    carry = r >>> 26
                }
                for (; carry !== 0 && i < a.length; i++) {
                    r = (a.words[i] | 0) + carry;
                    this.words[i] = r & 67108863;
                    carry = r >>> 26
                }
                this.length = a.length;
                if (carry !== 0) {
                    this.words[this.length] = carry;
                    this.length++
                } else if (a !== this) {
                    for (; i < a.length; i++) {
                        this.words[i] = a.words[i]
                    }
                }
                return this
            };
            BN.prototype.add = function add(num) {
                var res;
                if (num.negative !== 0 && this.negative === 0) {
                    num.negative = 0;
                    res = this.sub(num);
                    num.negative ^= 1;
                    return res
                } else if (num.negative === 0 && this.negative !== 0) {
                    this.negative = 0;
                    res = num.sub(this);
                    this.negative = 1;
                    return res
                }
                if (this.length > num.length) return this.clone().iadd(num);
                return num.clone().iadd(this)
            };
            BN.prototype.isub = function isub(num) {
                if (num.negative !== 0) {
                    num.negative = 0;
                    var r = this.iadd(num);
                    num.negative = 1;
                    return r._normSign()
                } else if (this.negative !== 0) {
                    this.negative = 0;
                    this.iadd(num);
                    this.negative = 1;
                    return this._normSign()
                }
                var cmp = this.cmp(num);
                if (cmp === 0) {
                    this.negative = 0;
                    this.length = 1;
                    this.words[0] = 0;
                    return this
                }
                var a, b;
                if (cmp > 0) {
                    a = this;
                    b = num
                } else {
                    a = num;
                    b = this
                }
                var carry = 0;
                for (var i = 0; i < b.length; i++) {
                    r = (a.words[i] | 0) - (b.words[i] | 0) + carry;
                    carry = r >> 26;
                    this.words[i] = r & 67108863
                }
                for (; carry !== 0 && i < a.length; i++) {
                    r = (a.words[i] | 0) + carry;
                    carry = r >> 26;
                    this.words[i] = r & 67108863
                }
                if (carry === 0 && i < a.length && a !== this) {
                    for (; i < a.length; i++) {
                        this.words[i] = a.words[i]
                    }
                }
                this.length = Math.max(this.length, i);
                if (a !== this) {
                    this.negative = 1
                }
                return this.strip()
            };
            BN.prototype.sub = function sub(num) {
                return this.clone().isub(num)
            };

            function smallMulTo(self, num, out) {
                out.negative = num.negative ^ self.negative;
                var len = self.length + num.length | 0;
                out.length = len;
                len = len - 1 | 0;
                var a = self.words[0] | 0;
                var b = num.words[0] | 0;
                var r = a * b;
                var lo = r & 67108863;
                var carry = r / 67108864 | 0;
                out.words[0] = lo;
                for (var k = 1; k < len; k++) {
                    var ncarry = carry >>> 26;
                    var rword = carry & 67108863;
                    var maxJ = Math.min(k, num.length - 1);
                    for (var j = Math.max(0, k - self.length + 1); j <= maxJ; j++) {
                        var i = k - j | 0;
                        a = self.words[i] | 0;
                        b = num.words[j] | 0;
                        r = a * b + rword;
                        ncarry += r / 67108864 | 0;
                        rword = r & 67108863
                    }
                    out.words[k] = rword | 0;
                    carry = ncarry | 0
                }
                if (carry !== 0) {
                    out.words[k] = carry | 0
                } else {
                    out.length--
                }
                return out.strip()
            }
            var comb10MulTo = function comb10MulTo(self, num, out) {
                var a = self.words;
                var b = num.words;
                var o = out.words;
                var c = 0;
                var lo;
                var mid;
                var hi;
                var a0 = a[0] | 0;
                var al0 = a0 & 8191;
                var ah0 = a0 >>> 13;
                var a1 = a[1] | 0;
                var al1 = a1 & 8191;
                var ah1 = a1 >>> 13;
                var a2 = a[2] | 0;
                var al2 = a2 & 8191;
                var ah2 = a2 >>> 13;
                var a3 = a[3] | 0;
                var al3 = a3 & 8191;
                var ah3 = a3 >>> 13;
                var a4 = a[4] | 0;
                var al4 = a4 & 8191;
                var ah4 = a4 >>> 13;
                var a5 = a[5] | 0;
                var al5 = a5 & 8191;
                var ah5 = a5 >>> 13;
                var a6 = a[6] | 0;
                var al6 = a6 & 8191;
                var ah6 = a6 >>> 13;
                var a7 = a[7] | 0;
                var al7 = a7 & 8191;
                var ah7 = a7 >>> 13;
                var a8 = a[8] | 0;
                var al8 = a8 & 8191;
                var ah8 = a8 >>> 13;
                var a9 = a[9] | 0;
                var al9 = a9 & 8191;
                var ah9 = a9 >>> 13;
                var b0 = b[0] | 0;
                var bl0 = b0 & 8191;
                var bh0 = b0 >>> 13;
                var b1 = b[1] | 0;
                var bl1 = b1 & 8191;
                var bh1 = b1 >>> 13;
                var b2 = b[2] | 0;
                var bl2 = b2 & 8191;
                var bh2 = b2 >>> 13;
                var b3 = b[3] | 0;
                var bl3 = b3 & 8191;
                var bh3 = b3 >>> 13;
                var b4 = b[4] | 0;
                var bl4 = b4 & 8191;
                var bh4 = b4 >>> 13;
                var b5 = b[5] | 0;
                var bl5 = b5 & 8191;
                var bh5 = b5 >>> 13;
                var b6 = b[6] | 0;
                var bl6 = b6 & 8191;
                var bh6 = b6 >>> 13;
                var b7 = b[7] | 0;
                var bl7 = b7 & 8191;
                var bh7 = b7 >>> 13;
                var b8 = b[8] | 0;
                var bl8 = b8 & 8191;
                var bh8 = b8 >>> 13;
                var b9 = b[9] | 0;
                var bl9 = b9 & 8191;
                var bh9 = b9 >>> 13;
                out.negative = self.negative ^ num.negative;
                out.length = 19;
                lo = Math.imul(al0, bl0);
                mid = Math.imul(al0, bh0);
                mid = mid + Math.imul(ah0, bl0) | 0;
                hi = Math.imul(ah0, bh0);
                var w0 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w0 >>> 26) | 0;
                w0 &= 67108863;
                lo = Math.imul(al1, bl0);
                mid = Math.imul(al1, bh0);
                mid = mid + Math.imul(ah1, bl0) | 0;
                hi = Math.imul(ah1, bh0);
                lo = lo + Math.imul(al0, bl1) | 0;
                mid = mid + Math.imul(al0, bh1) | 0;
                mid = mid + Math.imul(ah0, bl1) | 0;
                hi = hi + Math.imul(ah0, bh1) | 0;
                var w1 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w1 >>> 26) | 0;
                w1 &= 67108863;
                lo = Math.imul(al2, bl0);
                mid = Math.imul(al2, bh0);
                mid = mid + Math.imul(ah2, bl0) | 0;
                hi = Math.imul(ah2, bh0);
                lo = lo + Math.imul(al1, bl1) | 0;
                mid = mid + Math.imul(al1, bh1) | 0;
                mid = mid + Math.imul(ah1, bl1) | 0;
                hi = hi + Math.imul(ah1, bh1) | 0;
                lo = lo + Math.imul(al0, bl2) | 0;
                mid = mid + Math.imul(al0, bh2) | 0;
                mid = mid + Math.imul(ah0, bl2) | 0;
                hi = hi + Math.imul(ah0, bh2) | 0;
                var w2 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w2 >>> 26) | 0;
                w2 &= 67108863;
                lo = Math.imul(al3, bl0);
                mid = Math.imul(al3, bh0);
                mid = mid + Math.imul(ah3, bl0) | 0;
                hi = Math.imul(ah3, bh0);
                lo = lo + Math.imul(al2, bl1) | 0;
                mid = mid + Math.imul(al2, bh1) | 0;
                mid = mid + Math.imul(ah2, bl1) | 0;
                hi = hi + Math.imul(ah2, bh1) | 0;
                lo = lo + Math.imul(al1, bl2) | 0;
                mid = mid + Math.imul(al1, bh2) | 0;
                mid = mid + Math.imul(ah1, bl2) | 0;
                hi = hi + Math.imul(ah1, bh2) | 0;
                lo = lo + Math.imul(al0, bl3) | 0;
                mid = mid + Math.imul(al0, bh3) | 0;
                mid = mid + Math.imul(ah0, bl3) | 0;
                hi = hi + Math.imul(ah0, bh3) | 0;
                var w3 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w3 >>> 26) | 0;
                w3 &= 67108863;
                lo = Math.imul(al4, bl0);
                mid = Math.imul(al4, bh0);
                mid = mid + Math.imul(ah4, bl0) | 0;
                hi = Math.imul(ah4, bh0);
                lo = lo + Math.imul(al3, bl1) | 0;
                mid = mid + Math.imul(al3, bh1) | 0;
                mid = mid + Math.imul(ah3, bl1) | 0;
                hi = hi + Math.imul(ah3, bh1) | 0;
                lo = lo + Math.imul(al2, bl2) | 0;
                mid = mid + Math.imul(al2, bh2) | 0;
                mid = mid + Math.imul(ah2, bl2) | 0;
                hi = hi + Math.imul(ah2, bh2) | 0;
                lo = lo + Math.imul(al1, bl3) | 0;
                mid = mid + Math.imul(al1, bh3) | 0;
                mid = mid + Math.imul(ah1, bl3) | 0;
                hi = hi + Math.imul(ah1, bh3) | 0;
                lo = lo + Math.imul(al0, bl4) | 0;
                mid = mid + Math.imul(al0, bh4) | 0;
                mid = mid + Math.imul(ah0, bl4) | 0;
                hi = hi + Math.imul(ah0, bh4) | 0;
                var w4 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w4 >>> 26) | 0;
                w4 &= 67108863;
                lo = Math.imul(al5, bl0);
                mid = Math.imul(al5, bh0);
                mid = mid + Math.imul(ah5, bl0) | 0;
                hi = Math.imul(ah5, bh0);
                lo = lo + Math.imul(al4, bl1) | 0;
                mid = mid + Math.imul(al4, bh1) | 0;
                mid = mid + Math.imul(ah4, bl1) | 0;
                hi = hi + Math.imul(ah4, bh1) | 0;
                lo = lo + Math.imul(al3, bl2) | 0;
                mid = mid + Math.imul(al3, bh2) | 0;
                mid = mid + Math.imul(ah3, bl2) | 0;
                hi = hi + Math.imul(ah3, bh2) | 0;
                lo = lo + Math.imul(al2, bl3) | 0;
                mid = mid + Math.imul(al2, bh3) | 0;
                mid = mid + Math.imul(ah2, bl3) | 0;
                hi = hi + Math.imul(ah2, bh3) | 0;
                lo = lo + Math.imul(al1, bl4) | 0;
                mid = mid + Math.imul(al1, bh4) | 0;
                mid = mid + Math.imul(ah1, bl4) | 0;
                hi = hi + Math.imul(ah1, bh4) | 0;
                lo = lo + Math.imul(al0, bl5) | 0;
                mid = mid + Math.imul(al0, bh5) | 0;
                mid = mid + Math.imul(ah0, bl5) | 0;
                hi = hi + Math.imul(ah0, bh5) | 0;
                var w5 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w5 >>> 26) | 0;
                w5 &= 67108863;
                lo = Math.imul(al6, bl0);
                mid = Math.imul(al6, bh0);
                mid = mid + Math.imul(ah6, bl0) | 0;
                hi = Math.imul(ah6, bh0);
                lo = lo + Math.imul(al5, bl1) | 0;
                mid = mid + Math.imul(al5, bh1) | 0;
                mid = mid + Math.imul(ah5, bl1) | 0;
                hi = hi + Math.imul(ah5, bh1) | 0;
                lo = lo + Math.imul(al4, bl2) | 0;
                mid = mid + Math.imul(al4, bh2) | 0;
                mid = mid + Math.imul(ah4, bl2) | 0;
                hi = hi + Math.imul(ah4, bh2) | 0;
                lo = lo + Math.imul(al3, bl3) | 0;
                mid = mid + Math.imul(al3, bh3) | 0;
                mid = mid + Math.imul(ah3, bl3) | 0;
                hi = hi + Math.imul(ah3, bh3) | 0;
                lo = lo + Math.imul(al2, bl4) | 0;
                mid = mid + Math.imul(al2, bh4) | 0;
                mid = mid + Math.imul(ah2, bl4) | 0;
                hi = hi + Math.imul(ah2, bh4) | 0;
                lo = lo + Math.imul(al1, bl5) | 0;
                mid = mid + Math.imul(al1, bh5) | 0;
                mid = mid + Math.imul(ah1, bl5) | 0;
                hi = hi + Math.imul(ah1, bh5) | 0;
                lo = lo + Math.imul(al0, bl6) | 0;
                mid = mid + Math.imul(al0, bh6) | 0;
                mid = mid + Math.imul(ah0, bl6) | 0;
                hi = hi + Math.imul(ah0, bh6) | 0;
                var w6 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w6 >>> 26) | 0;
                w6 &= 67108863;
                lo = Math.imul(al7, bl0);
                mid = Math.imul(al7, bh0);
                mid = mid + Math.imul(ah7, bl0) | 0;
                hi = Math.imul(ah7, bh0);
                lo = lo + Math.imul(al6, bl1) | 0;
                mid = mid + Math.imul(al6, bh1) | 0;
                mid = mid + Math.imul(ah6, bl1) | 0;
                hi = hi + Math.imul(ah6, bh1) | 0;
                lo = lo + Math.imul(al5, bl2) | 0;
                mid = mid + Math.imul(al5, bh2) | 0;
                mid = mid + Math.imul(ah5, bl2) | 0;
                hi = hi + Math.imul(ah5, bh2) | 0;
                lo = lo + Math.imul(al4, bl3) | 0;
                mid = mid + Math.imul(al4, bh3) | 0;
                mid = mid + Math.imul(ah4, bl3) | 0;
                hi = hi + Math.imul(ah4, bh3) | 0;
                lo = lo + Math.imul(al3, bl4) | 0;
                mid = mid + Math.imul(al3, bh4) | 0;
                mid = mid + Math.imul(ah3, bl4) | 0;
                hi = hi + Math.imul(ah3, bh4) | 0;
                lo = lo + Math.imul(al2, bl5) | 0;
                mid = mid + Math.imul(al2, bh5) | 0;
                mid = mid + Math.imul(ah2, bl5) | 0;
                hi = hi + Math.imul(ah2, bh5) | 0;
                lo = lo + Math.imul(al1, bl6) | 0;
                mid = mid + Math.imul(al1, bh6) | 0;
                mid = mid + Math.imul(ah1, bl6) | 0;
                hi = hi + Math.imul(ah1, bh6) | 0;
                lo = lo + Math.imul(al0, bl7) | 0;
                mid = mid + Math.imul(al0, bh7) | 0;
                mid = mid + Math.imul(ah0, bl7) | 0;
                hi = hi + Math.imul(ah0, bh7) | 0;
                var w7 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w7 >>> 26) | 0;
                w7 &= 67108863;
                lo = Math.imul(al8, bl0);
                mid = Math.imul(al8, bh0);
                mid = mid + Math.imul(ah8, bl0) | 0;
                hi = Math.imul(ah8, bh0);
                lo = lo + Math.imul(al7, bl1) | 0;
                mid = mid + Math.imul(al7, bh1) | 0;
                mid = mid + Math.imul(ah7, bl1) | 0;
                hi = hi + Math.imul(ah7, bh1) | 0;
                lo = lo + Math.imul(al6, bl2) | 0;
                mid = mid + Math.imul(al6, bh2) | 0;
                mid = mid + Math.imul(ah6, bl2) | 0;
                hi = hi + Math.imul(ah6, bh2) | 0;
                lo = lo + Math.imul(al5, bl3) | 0;
                mid = mid + Math.imul(al5, bh3) | 0;
                mid = mid + Math.imul(ah5, bl3) | 0;
                hi = hi + Math.imul(ah5, bh3) | 0;
                lo = lo + Math.imul(al4, bl4) | 0;
                mid = mid + Math.imul(al4, bh4) | 0;
                mid = mid + Math.imul(ah4, bl4) | 0;
                hi = hi + Math.imul(ah4, bh4) | 0;
                lo = lo + Math.imul(al3, bl5) | 0;
                mid = mid + Math.imul(al3, bh5) | 0;
                mid = mid + Math.imul(ah3, bl5) | 0;
                hi = hi + Math.imul(ah3, bh5) | 0;
                lo = lo + Math.imul(al2, bl6) | 0;
                mid = mid + Math.imul(al2, bh6) | 0;
                mid = mid + Math.imul(ah2, bl6) | 0;
                hi = hi + Math.imul(ah2, bh6) | 0;
                lo = lo + Math.imul(al1, bl7) | 0;
                mid = mid + Math.imul(al1, bh7) | 0;
                mid = mid + Math.imul(ah1, bl7) | 0;
                hi = hi + Math.imul(ah1, bh7) | 0;
                lo = lo + Math.imul(al0, bl8) | 0;
                mid = mid + Math.imul(al0, bh8) | 0;
                mid = mid + Math.imul(ah0, bl8) | 0;
                hi = hi + Math.imul(ah0, bh8) | 0;
                var w8 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w8 >>> 26) | 0;
                w8 &= 67108863;
                lo = Math.imul(al9, bl0);
                mid = Math.imul(al9, bh0);
                mid = mid + Math.imul(ah9, bl0) | 0;
                hi = Math.imul(ah9, bh0);
                lo = lo + Math.imul(al8, bl1) | 0;
                mid = mid + Math.imul(al8, bh1) | 0;
                mid = mid + Math.imul(ah8, bl1) | 0;
                hi = hi + Math.imul(ah8, bh1) | 0;
                lo = lo + Math.imul(al7, bl2) | 0;
                mid = mid + Math.imul(al7, bh2) | 0;
                mid = mid + Math.imul(ah7, bl2) | 0;
                hi = hi + Math.imul(ah7, bh2) | 0;
                lo = lo + Math.imul(al6, bl3) | 0;
                mid = mid + Math.imul(al6, bh3) | 0;
                mid = mid + Math.imul(ah6, bl3) | 0;
                hi = hi + Math.imul(ah6, bh3) | 0;
                lo = lo + Math.imul(al5, bl4) | 0;
                mid = mid + Math.imul(al5, bh4) | 0;
                mid = mid + Math.imul(ah5, bl4) | 0;
                hi = hi + Math.imul(ah5, bh4) | 0;
                lo = lo + Math.imul(al4, bl5) | 0;
                mid = mid + Math.imul(al4, bh5) | 0;
                mid = mid + Math.imul(ah4, bl5) | 0;
                hi = hi + Math.imul(ah4, bh5) | 0;
                lo = lo + Math.imul(al3, bl6) | 0;
                mid = mid + Math.imul(al3, bh6) | 0;
                mid = mid + Math.imul(ah3, bl6) | 0;
                hi = hi + Math.imul(ah3, bh6) | 0;
                lo = lo + Math.imul(al2, bl7) | 0;
                mid = mid + Math.imul(al2, bh7) | 0;
                mid = mid + Math.imul(ah2, bl7) | 0;
                hi = hi + Math.imul(ah2, bh7) | 0;
                lo = lo + Math.imul(al1, bl8) | 0;
                mid = mid + Math.imul(al1, bh8) | 0;
                mid = mid + Math.imul(ah1, bl8) | 0;
                hi = hi + Math.imul(ah1, bh8) | 0;
                lo = lo + Math.imul(al0, bl9) | 0;
                mid = mid + Math.imul(al0, bh9) | 0;
                mid = mid + Math.imul(ah0, bl9) | 0;
                hi = hi + Math.imul(ah0, bh9) | 0;
                var w9 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w9 >>> 26) | 0;
                w9 &= 67108863;
                lo = Math.imul(al9, bl1);
                mid = Math.imul(al9, bh1);
                mid = mid + Math.imul(ah9, bl1) | 0;
                hi = Math.imul(ah9, bh1);
                lo = lo + Math.imul(al8, bl2) | 0;
                mid = mid + Math.imul(al8, bh2) | 0;
                mid = mid + Math.imul(ah8, bl2) | 0;
                hi = hi + Math.imul(ah8, bh2) | 0;
                lo = lo + Math.imul(al7, bl3) | 0;
                mid = mid + Math.imul(al7, bh3) | 0;
                mid = mid + Math.imul(ah7, bl3) | 0;
                hi = hi + Math.imul(ah7, bh3) | 0;
                lo = lo + Math.imul(al6, bl4) | 0;
                mid = mid + Math.imul(al6, bh4) | 0;
                mid = mid + Math.imul(ah6, bl4) | 0;
                hi = hi + Math.imul(ah6, bh4) | 0;
                lo = lo + Math.imul(al5, bl5) | 0;
                mid = mid + Math.imul(al5, bh5) | 0;
                mid = mid + Math.imul(ah5, bl5) | 0;
                hi = hi + Math.imul(ah5, bh5) | 0;
                lo = lo + Math.imul(al4, bl6) | 0;
                mid = mid + Math.imul(al4, bh6) | 0;
                mid = mid + Math.imul(ah4, bl6) | 0;
                hi = hi + Math.imul(ah4, bh6) | 0;
                lo = lo + Math.imul(al3, bl7) | 0;
                mid = mid + Math.imul(al3, bh7) | 0;
                mid = mid + Math.imul(ah3, bl7) | 0;
                hi = hi + Math.imul(ah3, bh7) | 0;
                lo = lo + Math.imul(al2, bl8) | 0;
                mid = mid + Math.imul(al2, bh8) | 0;
                mid = mid + Math.imul(ah2, bl8) | 0;
                hi = hi + Math.imul(ah2, bh8) | 0;
                lo = lo + Math.imul(al1, bl9) | 0;
                mid = mid + Math.imul(al1, bh9) | 0;
                mid = mid + Math.imul(ah1, bl9) | 0;
                hi = hi + Math.imul(ah1, bh9) | 0;
                var w10 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w10 >>> 26) | 0;
                w10 &= 67108863;
                lo = Math.imul(al9, bl2);
                mid = Math.imul(al9, bh2);
                mid = mid + Math.imul(ah9, bl2) | 0;
                hi = Math.imul(ah9, bh2);
                lo = lo + Math.imul(al8, bl3) | 0;
                mid = mid + Math.imul(al8, bh3) | 0;
                mid = mid + Math.imul(ah8, bl3) | 0;
                hi = hi + Math.imul(ah8, bh3) | 0;
                lo = lo + Math.imul(al7, bl4) | 0;
                mid = mid + Math.imul(al7, bh4) | 0;
                mid = mid + Math.imul(ah7, bl4) | 0;
                hi = hi + Math.imul(ah7, bh4) | 0;
                lo = lo + Math.imul(al6, bl5) | 0;
                mid = mid + Math.imul(al6, bh5) | 0;
                mid = mid + Math.imul(ah6, bl5) | 0;
                hi = hi + Math.imul(ah6, bh5) | 0;
                lo = lo + Math.imul(al5, bl6) | 0;
                mid = mid + Math.imul(al5, bh6) | 0;
                mid = mid + Math.imul(ah5, bl6) | 0;
                hi = hi + Math.imul(ah5, bh6) | 0;
                lo = lo + Math.imul(al4, bl7) | 0;
                mid = mid + Math.imul(al4, bh7) | 0;
                mid = mid + Math.imul(ah4, bl7) | 0;
                hi = hi + Math.imul(ah4, bh7) | 0;
                lo = lo + Math.imul(al3, bl8) | 0;
                mid = mid + Math.imul(al3, bh8) | 0;
                mid = mid + Math.imul(ah3, bl8) | 0;
                hi = hi + Math.imul(ah3, bh8) | 0;
                lo = lo + Math.imul(al2, bl9) | 0;
                mid = mid + Math.imul(al2, bh9) | 0;
                mid = mid + Math.imul(ah2, bl9) | 0;
                hi = hi + Math.imul(ah2, bh9) | 0;
                var w11 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w11 >>> 26) | 0;
                w11 &= 67108863;
                lo = Math.imul(al9, bl3);
                mid = Math.imul(al9, bh3);
                mid = mid + Math.imul(ah9, bl3) | 0;
                hi = Math.imul(ah9, bh3);
                lo = lo + Math.imul(al8, bl4) | 0;
                mid = mid + Math.imul(al8, bh4) | 0;
                mid = mid + Math.imul(ah8, bl4) | 0;
                hi = hi + Math.imul(ah8, bh4) | 0;
                lo = lo + Math.imul(al7, bl5) | 0;
                mid = mid + Math.imul(al7, bh5) | 0;
                mid = mid + Math.imul(ah7, bl5) | 0;
                hi = hi + Math.imul(ah7, bh5) | 0;
                lo = lo + Math.imul(al6, bl6) | 0;
                mid = mid + Math.imul(al6, bh6) | 0;
                mid = mid + Math.imul(ah6, bl6) | 0;
                hi = hi + Math.imul(ah6, bh6) | 0;
                lo = lo + Math.imul(al5, bl7) | 0;
                mid = mid + Math.imul(al5, bh7) | 0;
                mid = mid + Math.imul(ah5, bl7) | 0;
                hi = hi + Math.imul(ah5, bh7) | 0;
                lo = lo + Math.imul(al4, bl8) | 0;
                mid = mid + Math.imul(al4, bh8) | 0;
                mid = mid + Math.imul(ah4, bl8) | 0;
                hi = hi + Math.imul(ah4, bh8) | 0;
                lo = lo + Math.imul(al3, bl9) | 0;
                mid = mid + Math.imul(al3, bh9) | 0;
                mid = mid + Math.imul(ah3, bl9) | 0;
                hi = hi + Math.imul(ah3, bh9) | 0;
                var w12 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w12 >>> 26) | 0;
                w12 &= 67108863;
                lo = Math.imul(al9, bl4);
                mid = Math.imul(al9, bh4);
                mid = mid + Math.imul(ah9, bl4) | 0;
                hi = Math.imul(ah9, bh4);
                lo = lo + Math.imul(al8, bl5) | 0;
                mid = mid + Math.imul(al8, bh5) | 0;
                mid = mid + Math.imul(ah8, bl5) | 0;
                hi = hi + Math.imul(ah8, bh5) | 0;
                lo = lo + Math.imul(al7, bl6) | 0;
                mid = mid + Math.imul(al7, bh6) | 0;
                mid = mid + Math.imul(ah7, bl6) | 0;
                hi = hi + Math.imul(ah7, bh6) | 0;
                lo = lo + Math.imul(al6, bl7) | 0;
                mid = mid + Math.imul(al6, bh7) | 0;
                mid = mid + Math.imul(ah6, bl7) | 0;
                hi = hi + Math.imul(ah6, bh7) | 0;
                lo = lo + Math.imul(al5, bl8) | 0;
                mid = mid + Math.imul(al5, bh8) | 0;
                mid = mid + Math.imul(ah5, bl8) | 0;
                hi = hi + Math.imul(ah5, bh8) | 0;
                lo = lo + Math.imul(al4, bl9) | 0;
                mid = mid + Math.imul(al4, bh9) | 0;
                mid = mid + Math.imul(ah4, bl9) | 0;
                hi = hi + Math.imul(ah4, bh9) | 0;
                var w13 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w13 >>> 26) | 0;
                w13 &= 67108863;
                lo = Math.imul(al9, bl5);
                mid = Math.imul(al9, bh5);
                mid = mid + Math.imul(ah9, bl5) | 0;
                hi = Math.imul(ah9, bh5);
                lo = lo + Math.imul(al8, bl6) | 0;
                mid = mid + Math.imul(al8, bh6) | 0;
                mid = mid + Math.imul(ah8, bl6) | 0;
                hi = hi + Math.imul(ah8, bh6) | 0;
                lo = lo + Math.imul(al7, bl7) | 0;
                mid = mid + Math.imul(al7, bh7) | 0;
                mid = mid + Math.imul(ah7, bl7) | 0;
                hi = hi + Math.imul(ah7, bh7) | 0;
                lo = lo + Math.imul(al6, bl8) | 0;
                mid = mid + Math.imul(al6, bh8) | 0;
                mid = mid + Math.imul(ah6, bl8) | 0;
                hi = hi + Math.imul(ah6, bh8) | 0;
                lo = lo + Math.imul(al5, bl9) | 0;
                mid = mid + Math.imul(al5, bh9) | 0;
                mid = mid + Math.imul(ah5, bl9) | 0;
                hi = hi + Math.imul(ah5, bh9) | 0;
                var w14 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w14 >>> 26) | 0;
                w14 &= 67108863;
                lo = Math.imul(al9, bl6);
                mid = Math.imul(al9, bh6);
                mid = mid + Math.imul(ah9, bl6) | 0;
                hi = Math.imul(ah9, bh6);
                lo = lo + Math.imul(al8, bl7) | 0;
                mid = mid + Math.imul(al8, bh7) | 0;
                mid = mid + Math.imul(ah8, bl7) | 0;
                hi = hi + Math.imul(ah8, bh7) | 0;
                lo = lo + Math.imul(al7, bl8) | 0;
                mid = mid + Math.imul(al7, bh8) | 0;
                mid = mid + Math.imul(ah7, bl8) | 0;
                hi = hi + Math.imul(ah7, bh8) | 0;
                lo = lo + Math.imul(al6, bl9) | 0;
                mid = mid + Math.imul(al6, bh9) | 0;
                mid = mid + Math.imul(ah6, bl9) | 0;
                hi = hi + Math.imul(ah6, bh9) | 0;
                var w15 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w15 >>> 26) | 0;
                w15 &= 67108863;
                lo = Math.imul(al9, bl7);
                mid = Math.imul(al9, bh7);
                mid = mid + Math.imul(ah9, bl7) | 0;
                hi = Math.imul(ah9, bh7);
                lo = lo + Math.imul(al8, bl8) | 0;
                mid = mid + Math.imul(al8, bh8) | 0;
                mid = mid + Math.imul(ah8, bl8) | 0;
                hi = hi + Math.imul(ah8, bh8) | 0;
                lo = lo + Math.imul(al7, bl9) | 0;
                mid = mid + Math.imul(al7, bh9) | 0;
                mid = mid + Math.imul(ah7, bl9) | 0;
                hi = hi + Math.imul(ah7, bh9) | 0;
                var w16 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w16 >>> 26) | 0;
                w16 &= 67108863;
                lo = Math.imul(al9, bl8);
                mid = Math.imul(al9, bh8);
                mid = mid + Math.imul(ah9, bl8) | 0;
                hi = Math.imul(ah9, bh8);
                lo = lo + Math.imul(al8, bl9) | 0;
                mid = mid + Math.imul(al8, bh9) | 0;
                mid = mid + Math.imul(ah8, bl9) | 0;
                hi = hi + Math.imul(ah8, bh9) | 0;
                var w17 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w17 >>> 26) | 0;
                w17 &= 67108863;
                lo = Math.imul(al9, bl9);
                mid = Math.imul(al9, bh9);
                mid = mid + Math.imul(ah9, bl9) | 0;
                hi = Math.imul(ah9, bh9);
                var w18 = (c + lo | 0) + ((mid & 8191) << 13) | 0;
                c = (hi + (mid >>> 13) | 0) + (w18 >>> 26) | 0;
                w18 &= 67108863;
                o[0] = w0;
                o[1] = w1;
                o[2] = w2;
                o[3] = w3;
                o[4] = w4;
                o[5] = w5;
                o[6] = w6;
                o[7] = w7;
                o[8] = w8;
                o[9] = w9;
                o[10] = w10;
                o[11] = w11;
                o[12] = w12;
                o[13] = w13;
                o[14] = w14;
                o[15] = w15;
                o[16] = w16;
                o[17] = w17;
                o[18] = w18;
                if (c !== 0) {
                    o[19] = c;
                    out.length++
                }
                return out
            };
            if (!Math.imul) {
                comb10MulTo = smallMulTo
            }

            function bigMulTo(self, num, out) {
                out.negative = num.negative ^ self.negative;
                out.length = self.length + num.length;
                var carry = 0;
                var hncarry = 0;
                for (var k = 0; k < out.length - 1; k++) {
                    var ncarry = hncarry;
                    hncarry = 0;
                    var rword = carry & 67108863;
                    var maxJ = Math.min(k, num.length - 1);
                    for (var j = Math.max(0, k - self.length + 1); j <= maxJ; j++) {
                        var i = k - j;
                        var a = self.words[i] | 0;
                        var b = num.words[j] | 0;
                        var r = a * b;
                        var lo = r & 67108863;
                        ncarry = ncarry + (r / 67108864 | 0) | 0;
                        lo = lo + rword | 0;
                        rword = lo & 67108863;
                        ncarry = ncarry + (lo >>> 26) | 0;
                        hncarry += ncarry >>> 26;
                        ncarry &= 67108863
                    }
                    out.words[k] = rword;
                    carry = ncarry;
                    ncarry = hncarry
                }
                if (carry !== 0) {
                    out.words[k] = carry
                } else {
                    out.length--
                }
                return out.strip()
            }

            function jumboMulTo(self, num, out) {
                var fftm = new FFTM;
                return fftm.mulp(self, num, out)
            }
            BN.prototype.mulTo = function mulTo(num, out) {
                var res;
                var len = this.length + num.length;
                if (this.length === 10 && num.length === 10) {
                    res = comb10MulTo(this, num, out)
                } else if (len < 63) {
                    res = smallMulTo(this, num, out)
                } else if (len < 1024) {
                    res = bigMulTo(this, num, out)
                } else {
                    res = jumboMulTo(this, num, out)
                }
                return res
            };

            function FFTM(x, y) {
                this.x = x;
                this.y = y
            }
            FFTM.prototype.makeRBT = function makeRBT(N) {
                var t = new Array(N);
                var l = BN.prototype._countBits(N) - 1;
                for (var i = 0; i < N; i++) {
                    t[i] = this.revBin(i, l, N)
                }
                return t
            };
            FFTM.prototype.revBin = function revBin(x, l, N) {
                if (x === 0 || x === N - 1) return x;
                var rb = 0;
                for (var i = 0; i < l; i++) {
                    rb |= (x & 1) << l - i - 1;
                    x >>= 1
                }
                return rb
            };
            FFTM.prototype.permute = function permute(rbt, rws, iws, rtws, itws, N) {
                for (var i = 0; i < N; i++) {
                    rtws[i] = rws[rbt[i]];
                    itws[i] = iws[rbt[i]]
                }
            };
            FFTM.prototype.transform = function transform(rws, iws, rtws, itws, N, rbt) {
                this.permute(rbt, rws, iws, rtws, itws, N);
                for (var s = 1; s < N; s <<= 1) {
                    var l = s << 1;
                    var rtwdf = Math.cos(2 * Math.PI / l);
                    var itwdf = Math.sin(2 * Math.PI / l);
                    for (var p = 0; p < N; p += l) {
                        var rtwdf_ = rtwdf;
                        var itwdf_ = itwdf;
                        for (var j = 0; j < s; j++) {
                            var re = rtws[p + j];
                            var ie = itws[p + j];
                            var ro = rtws[p + j + s];
                            var io = itws[p + j + s];
                            var rx = rtwdf_ * ro - itwdf_ * io;
                            io = rtwdf_ * io + itwdf_ * ro;
                            ro = rx;
                            rtws[p + j] = re + ro;
                            itws[p + j] = ie + io;
                            rtws[p + j + s] = re - ro;
                            itws[p + j + s] = ie - io;
                            if (j !== l) {
                                rx = rtwdf * rtwdf_ - itwdf * itwdf_;
                                itwdf_ = rtwdf * itwdf_ + itwdf * rtwdf_;
                                rtwdf_ = rx
                            }
                        }
                    }
                }
            };
            FFTM.prototype.guessLen13b = function guessLen13b(n, m) {
                var N = Math.max(m, n) | 1;
                var odd = N & 1;
                var i = 0;
                for (N = N / 2 | 0; N; N = N >>> 1) {
                    i++
                }
                return 1 << i + 1 + odd
            };
            FFTM.prototype.conjugate = function conjugate(rws, iws, N) {
                if (N <= 1) return;
                for (var i = 0; i < N / 2; i++) {
                    var t = rws[i];
                    rws[i] = rws[N - i - 1];
                    rws[N - i - 1] = t;
                    t = iws[i];
                    iws[i] = -iws[N - i - 1];
                    iws[N - i - 1] = -t
                }
            };
            FFTM.prototype.normalize13b = function normalize13b(ws, N) {
                var carry = 0;
                for (var i = 0; i < N / 2; i++) {
                    var w = Math.round(ws[2 * i + 1] / N) * 8192 + Math.round(ws[2 * i] / N) + carry;
                    ws[i] = w & 67108863;
                    if (w < 67108864) {
                        carry = 0
                    } else {
                        carry = w / 67108864 | 0
                    }
                }
                return ws
            };
            FFTM.prototype.convert13b = function convert13b(ws, len, rws, N) {
                var carry = 0;
                for (var i = 0; i < len; i++) {
                    carry = carry + (ws[i] | 0);
                    rws[2 * i] = carry & 8191;
                    carry = carry >>> 13;
                    rws[2 * i + 1] = carry & 8191;
                    carry = carry >>> 13
                }
                for (i = 2 * len; i < N; ++i) {
                    rws[i] = 0
                }
                assert(carry === 0);
                assert((carry & ~8191) === 0)
            };
            FFTM.prototype.stub = function stub(N) {
                var ph = new Array(N);
                for (var i = 0; i < N; i++) {
                    ph[i] = 0
                }
                return ph
            };
            FFTM.prototype.mulp = function mulp(x, y, out) {
                var N = 2 * this.guessLen13b(x.length, y.length);
                var rbt = this.makeRBT(N);
                var _ = this.stub(N);
                var rws = new Array(N);
                var rwst = new Array(N);
                var iwst = new Array(N);
                var nrws = new Array(N);
                var nrwst = new Array(N);
                var niwst = new Array(N);
                var rmws = out.words;
                rmws.length = N;
                this.convert13b(x.words, x.length, rws, N);
                this.convert13b(y.words, y.length, nrws, N);
                this.transform(rws, _, rwst, iwst, N, rbt);
                this.transform(nrws, _, nrwst, niwst, N, rbt);
                for (var i = 0; i < N; i++) {
                    var rx = rwst[i] * nrwst[i] - iwst[i] * niwst[i];
                    iwst[i] = rwst[i] * niwst[i] + iwst[i] * nrwst[i];
                    rwst[i] = rx
                }
                this.conjugate(rwst, iwst, N);
                this.transform(rwst, iwst, rmws, _, N, rbt);
                this.conjugate(rmws, _, N);
                this.normalize13b(rmws, N);
                out.negative = x.negative ^ y.negative;
                out.length = x.length + y.length;
                return out.strip()
            };
            BN.prototype.mul = function mul(num) {
                var out = new BN(null);
                out.words = new Array(this.length + num.length);
                return this.mulTo(num, out)
            };
            BN.prototype.mulf = function mulf(num) {
                var out = new BN(null);
                out.words = new Array(this.length + num.length);
                return jumboMulTo(this, num, out)
            };
            BN.prototype.imul = function imul(num) {
                return this.clone().mulTo(num, this)
            };
            BN.prototype.imuln = function imuln(num) {
                assert(typeof num === "number");
                assert(num < 67108864);
                var carry = 0;
                for (var i = 0; i < this.length; i++) {
                    var w = (this.words[i] | 0) * num;
                    var lo = (w & 67108863) + (carry & 67108863);
                    carry >>= 26;
                    carry += w / 67108864 | 0;
                    carry += lo >>> 26;
                    this.words[i] = lo & 67108863
                }
                if (carry !== 0) {
                    this.words[i] = carry;
                    this.length++
                }
                return this
            };
            BN.prototype.muln = function muln(num) {
                return this.clone().imuln(num)
            };
            BN.prototype.sqr = function sqr() {
                return this.mul(this)
            };
            BN.prototype.isqr = function isqr() {
                return this.imul(this.clone())
            };
            BN.prototype.pow = function pow(num) {
                var w = toBitArray(num);
                if (w.length === 0) return new BN(1);
                var res = this;
                for (var i = 0; i < w.length; i++, res = res.sqr()) {
                    if (w[i] !== 0) break
                }
                if (++i < w.length) {
                    for (var q = res.sqr(); i < w.length; i++, q = q.sqr()) {
                        if (w[i] === 0) continue;
                        res = res.mul(q)
                    }
                }
                return res
            };
            BN.prototype.iushln = function iushln(bits) {
                assert(typeof bits === "number" && bits >= 0);
                var r = bits % 26;
                var s = (bits - r) / 26;
                var carryMask = 67108863 >>> 26 - r << 26 - r;
                var i;
                if (r !== 0) {
                    var carry = 0;
                    for (i = 0; i < this.length; i++) {
                        var newCarry = this.words[i] & carryMask;
                        var c = (this.words[i] | 0) - newCarry << r;
                        this.words[i] = c | carry;
                        carry = newCarry >>> 26 - r
                    }
                    if (carry) {
                        this.words[i] = carry;
                        this.length++
                    }
                }
                if (s !== 0) {
                    for (i = this.length - 1; i >= 0; i--) {
                        this.words[i + s] = this.words[i]
                    }
                    for (i = 0; i < s; i++) {
                        this.words[i] = 0
                    }
                    this.length += s
                }
                return this.strip()
            };
            BN.prototype.ishln = function ishln(bits) {
                assert(this.negative === 0);
                return this.iushln(bits)
            };
            BN.prototype.iushrn = function iushrn(bits, hint, extended) {
                assert(typeof bits === "number" && bits >= 0);
                var h;
                if (hint) {
                    h = (hint - hint % 26) / 26
                } else {
                    h = 0
                }
                var r = bits % 26;
                var s = Math.min((bits - r) / 26, this.length);
                var mask = 67108863 ^ 67108863 >>> r << r;
                var maskedWords = extended;
                h -= s;
                h = Math.max(0, h);
                if (maskedWords) {
                    for (var i = 0; i < s; i++) {
                        maskedWords.words[i] = this.words[i]
                    }
                    maskedWords.length = s
                }
                if (s === 0) {} else if (this.length > s) {
                    this.length -= s;
                    for (i = 0; i < this.length; i++) {
                        this.words[i] = this.words[i + s]
                    }
                } else {
                    this.words[0] = 0;
                    this.length = 1
                }
                var carry = 0;
                for (i = this.length - 1; i >= 0 && (carry !== 0 || i >= h); i--) {
                    var word = this.words[i] | 0;
                    this.words[i] = carry << 26 - r | word >>> r;
                    carry = word & mask
                }
                if (maskedWords && carry !== 0) {
                    maskedWords.words[maskedWords.length++] = carry
                }
                if (this.length === 0) {
                    this.words[0] = 0;
                    this.length = 1
                }
                return this.strip()
            };
            BN.prototype.ishrn = function ishrn(bits, hint, extended) {
                assert(this.negative === 0);
                return this.iushrn(bits, hint, extended)
            };
            BN.prototype.shln = function shln(bits) {
                return this.clone().ishln(bits)
            };
            BN.prototype.ushln = function ushln(bits) {
                return this.clone().iushln(bits)
            };
            BN.prototype.shrn = function shrn(bits) {
                return this.clone().ishrn(bits)
            };
            BN.prototype.ushrn = function ushrn(bits) {
                return this.clone().iushrn(bits)
            };
            BN.prototype.testn = function testn(bit) {
                assert(typeof bit === "number" && bit >= 0);
                var r = bit % 26;
                var s = (bit - r) / 26;
                var q = 1 << r;
                if (this.length <= s) return false;
                var w = this.words[s];
                return !!(w & q)
            };
            BN.prototype.imaskn = function imaskn(bits) {
                assert(typeof bits === "number" && bits >= 0);
                var r = bits % 26;
                var s = (bits - r) / 26;
                assert(this.negative === 0, "imaskn works only with positive numbers");
                if (this.length <= s) {
                    return this
                }
                if (r !== 0) {
                    s++
                }
                this.length = Math.min(s, this.length);
                if (r !== 0) {
                    var mask = 67108863 ^ 67108863 >>> r << r;
                    this.words[this.length - 1] &= mask
                }
                return this.strip()
            };
            BN.prototype.maskn = function maskn(bits) {
                return this.clone().imaskn(bits)
            };
            BN.prototype.iaddn = function iaddn(num) {
                assert(typeof num === "number");
                assert(num < 67108864);
                if (num < 0) return this.isubn(-num);
                if (this.negative !== 0) {
                    if (this.length === 1 && (this.words[0] | 0) < num) {
                        this.words[0] = num - (this.words[0] | 0);
                        this.negative = 0;
                        return this
                    }
                    this.negative = 0;
                    this.isubn(num);
                    this.negative = 1;
                    return this
                }
                return this._iaddn(num)
            };
            BN.prototype._iaddn = function _iaddn(num) {
                this.words[0] += num;
                for (var i = 0; i < this.length && this.words[i] >= 67108864; i++) {
                    this.words[i] -= 67108864;
                    if (i === this.length - 1) {
                        this.words[i + 1] = 1
                    } else {
                        this.words[i + 1]++
                    }
                }
                this.length = Math.max(this.length, i + 1);
                return this
            };
            BN.prototype.isubn = function isubn(num) {
                assert(typeof num === "number");
                assert(num < 67108864);
                if (num < 0) return this.iaddn(-num);
                if (this.negative !== 0) {
                    this.negative = 0;
                    this.iaddn(num);
                    this.negative = 1;
                    return this
                }
                this.words[0] -= num;
                if (this.length === 1 && this.words[0] < 0) {
                    this.words[0] = -this.words[0];
                    this.negative = 1
                } else {
                    for (var i = 0; i < this.length && this.words[i] < 0; i++) {
                        this.words[i] += 67108864;
                        this.words[i + 1] -= 1
                    }
                }
                return this.strip()
            };
            BN.prototype.addn = function addn(num) {
                return this.clone().iaddn(num)
            };
            BN.prototype.subn = function subn(num) {
                return this.clone().isubn(num)
            };
            BN.prototype.iabs = function iabs() {
                this.negative = 0;
                return this
            };
            BN.prototype.abs = function abs() {
                return this.clone().iabs()
            };
            BN.prototype._ishlnsubmul = function _ishlnsubmul(num, mul, shift) {
                var len = num.length + shift;
                var i;
                this._expand(len);
                var w;
                var carry = 0;
                for (i = 0; i < num.length; i++) {
                    w = (this.words[i + shift] | 0) + carry;
                    var right = (num.words[i] | 0) * mul;
                    w -= right & 67108863;
                    carry = (w >> 26) - (right / 67108864 | 0);
                    this.words[i + shift] = w & 67108863
                }
                for (; i < this.length - shift; i++) {
                    w = (this.words[i + shift] | 0) + carry;
                    carry = w >> 26;
                    this.words[i + shift] = w & 67108863
                }
                if (carry === 0) return this.strip();
                assert(carry === -1);
                carry = 0;
                for (i = 0; i < this.length; i++) {
                    w = -(this.words[i] | 0) + carry;
                    carry = w >> 26;
                    this.words[i] = w & 67108863
                }
                this.negative = 1;
                return this.strip()
            };
            BN.prototype._wordDiv = function _wordDiv(num, mode) {
                var shift = this.length - num.length;
                var a = this.clone();
                var b = num;
                var bhi = b.words[b.length - 1] | 0;
                var bhiBits = this._countBits(bhi);
                shift = 26 - bhiBits;
                if (shift !== 0) {
                    b = b.ushln(shift);
                    a.iushln(shift);
                    bhi = b.words[b.length - 1] | 0
                }
                var m = a.length - b.length;
                var q;
                if (mode !== "mod") {
                    q = new BN(null);
                    q.length = m + 1;
                    q.words = new Array(q.length);
                    for (var i = 0; i < q.length; i++) {
                        q.words[i] = 0
                    }
                }
                var diff = a.clone()._ishlnsubmul(b, 1, m);
                if (diff.negative === 0) {
                    a = diff;
                    if (q) {
                        q.words[m] = 1
                    }
                }
                for (var j = m - 1; j >= 0; j--) {
                    var qj = (a.words[b.length + j] | 0) * 67108864 + (a.words[b.length + j - 1] | 0);
                    qj = Math.min(qj / bhi | 0, 67108863);
                    a._ishlnsubmul(b, qj, j);
                    while (a.negative !== 0) {
                        qj--;
                        a.negative = 0;
                        a._ishlnsubmul(b, 1, j);
                        if (!a.isZero()) {
                            a.negative ^= 1
                        }
                    }
                    if (q) {
                        q.words[j] = qj
                    }
                }
                if (q) {
                    q.strip()
                }
                a.strip();
                if (mode !== "div" && shift !== 0) {
                    a.iushrn(shift)
                }
                return {
                    div: q || null,
                    mod: a
                }
            };
            BN.prototype.divmod = function divmod(num, mode, positive) {
                assert(!num.isZero());
                if (this.isZero()) {
                    return {
                        div: new BN(0),
                        mod: new BN(0)
                    }
                }
                var div, mod, res;
                if (this.negative !== 0 && num.negative === 0) {
                    res = this.neg().divmod(num, mode);
                    if (mode !== "mod") {
                        div = res.div.neg()
                    }
                    if (mode !== "div") {
                        mod = res.mod.neg();
                        if (positive && mod.negative !== 0) {
                            mod.iadd(num)
                        }
                    }
                    return {
                        div: div,
                        mod: mod
                    }
                }
                if (this.negative === 0 && num.negative !== 0) {
                    res = this.divmod(num.neg(), mode);
                    if (mode !== "mod") {
                        div = res.div.neg()
                    }
                    return {
                        div: div,
                        mod: res.mod
                    }
                }
                if ((this.negative & num.negative) !== 0) {
                    res = this.neg().divmod(num.neg(), mode);
                    if (mode !== "div") {
                        mod = res.mod.neg();
                        if (positive && mod.negative !== 0) {
                            mod.isub(num)
                        }
                    }
                    return {
                        div: res.div,
                        mod: mod
                    }
                }
                if (num.length > this.length || this.cmp(num) < 0) {
                    return {
                        div: new BN(0),
                        mod: this
                    }
                }
                if (num.length === 1) {
                    if (mode === "div") {
                        return {
                            div: this.divn(num.words[0]),
                            mod: null
                        }
                    }
                    if (mode === "mod") {
                        return {
                            div: null,
                            mod: new BN(this.modn(num.words[0]))
                        }
                    }
                    return {
                        div: this.divn(num.words[0]),
                        mod: new BN(this.modn(num.words[0]))
                    }
                }
                return this._wordDiv(num, mode)
            };
            BN.prototype.div = function div(num) {
                return this.divmod(num, "div", false).div
            };
            BN.prototype.mod = function mod(num) {
                return this.divmod(num, "mod", false).mod
            };
            BN.prototype.umod = function umod(num) {
                return this.divmod(num, "mod", true).mod
            };
            BN.prototype.divRound = function divRound(num) {
                var dm = this.divmod(num);
                if (dm.mod.isZero()) return dm.div;
                var mod = dm.div.negative !== 0 ? dm.mod.isub(num) : dm.mod;
                var half = num.ushrn(1);
                var r2 = num.andln(1);
                var cmp = mod.cmp(half);
                if (cmp < 0 || r2 === 1 && cmp === 0) return dm.div;
                return dm.div.negative !== 0 ? dm.div.isubn(1) : dm.div.iaddn(1)
            };
            BN.prototype.modn = function modn(num) {
                assert(num <= 67108863);
                var p = (1 << 26) % num;
                var acc = 0;
                for (var i = this.length - 1; i >= 0; i--) {
                    acc = (p * acc + (this.words[i] | 0)) % num
                }
                return acc
            };
            BN.prototype.idivn = function idivn(num) {
                assert(num <= 67108863);
                var carry = 0;
                for (var i = this.length - 1; i >= 0; i--) {
                    var w = (this.words[i] | 0) + carry * 67108864;
                    this.words[i] = w / num | 0;
                    carry = w % num
                }
                return this.strip()
            };
            BN.prototype.divn = function divn(num) {
                return this.clone().idivn(num)
            };
            BN.prototype.egcd = function egcd(p) {
                assert(p.negative === 0);
                assert(!p.isZero());
                var x = this;
                var y = p.clone();
                if (x.negative !== 0) {
                    x = x.umod(p)
                } else {
                    x = x.clone()
                }
                var A = new BN(1);
                var B = new BN(0);
                var C = new BN(0);
                var D = new BN(1);
                var g = 0;
                while (x.isEven() && y.isEven()) {
                    x.iushrn(1);
                    y.iushrn(1);
                    ++g
                }
                var yp = y.clone();
                var xp = x.clone();
                while (!x.isZero()) {
                    for (var i = 0, im = 1;
                        (x.words[0] & im) === 0 && i < 26; ++i, im <<= 1);
                    if (i > 0) {
                        x.iushrn(i);
                        while (i-- > 0) {
                            if (A.isOdd() || B.isOdd()) {
                                A.iadd(yp);
                                B.isub(xp)
                            }
                            A.iushrn(1);
                            B.iushrn(1)
                        }
                    }
                    for (var j = 0, jm = 1;
                        (y.words[0] & jm) === 0 && j < 26; ++j, jm <<= 1);
                    if (j > 0) {
                        y.iushrn(j);
                        while (j-- > 0) {
                            if (C.isOdd() || D.isOdd()) {
                                C.iadd(yp);
                                D.isub(xp)
                            }
                            C.iushrn(1);
                            D.iushrn(1)
                        }
                    }
                    if (x.cmp(y) >= 0) {
                        x.isub(y);
                        A.isub(C);
                        B.isub(D)
                    } else {
                        y.isub(x);
                        C.isub(A);
                        D.isub(B)
                    }
                }
                return {
                    a: C,
                    b: D,
                    gcd: y.iushln(g)
                }
            };
            BN.prototype._invmp = function _invmp(p) {
                assert(p.negative === 0);
                assert(!p.isZero());
                var a = this;
                var b = p.clone();
                if (a.negative !== 0) {
                    a = a.umod(p)
                } else {
                    a = a.clone()
                }
                var x1 = new BN(1);
                var x2 = new BN(0);
                var delta = b.clone();
                while (a.cmpn(1) > 0 && b.cmpn(1) > 0) {
                    for (var i = 0, im = 1;
                        (a.words[0] & im) === 0 && i < 26; ++i, im <<= 1);
                    if (i > 0) {
                        a.iushrn(i);
                        while (i-- > 0) {
                            if (x1.isOdd()) {
                                x1.iadd(delta)
                            }
                            x1.iushrn(1)
                        }
                    }
                    for (var j = 0, jm = 1;
                        (b.words[0] & jm) === 0 && j < 26; ++j, jm <<= 1);
                    if (j > 0) {
                        b.iushrn(j);
                        while (j-- > 0) {
                            if (x2.isOdd()) {
                                x2.iadd(delta)
                            }
                            x2.iushrn(1)
                        }
                    }
                    if (a.cmp(b) >= 0) {
                        a.isub(b);
                        x1.isub(x2)
                    } else {
                        b.isub(a);
                        x2.isub(x1)
                    }
                }
                var res;
                if (a.cmpn(1) === 0) {
                    res = x1
                } else {
                    res = x2
                }
                if (res.cmpn(0) < 0) {
                    res.iadd(p)
                }
                return res
            };
            BN.prototype.gcd = function gcd(num) {
                if (this.isZero()) return num.abs();
                if (num.isZero()) return this.abs();
                var a = this.clone();
                var b = num.clone();
                a.negative = 0;
                b.negative = 0;
                for (var shift = 0; a.isEven() && b.isEven(); shift++) {
                    a.iushrn(1);
                    b.iushrn(1)
                }
                do {
                    while (a.isEven()) {
                        a.iushrn(1)
                    }
                    while (b.isEven()) {
                        b.iushrn(1)
                    }
                    var r = a.cmp(b);
                    if (r < 0) {
                        var t = a;
                        a = b;
                        b = t
                    } else if (r === 0 || b.cmpn(1) === 0) {
                        break
                    }
                    a.isub(b)
                } while (true);
                return b.iushln(shift)
            };
            BN.prototype.invm = function invm(num) {
                return this.egcd(num).a.umod(num)
            };
            BN.prototype.isEven = function isEven() {
                return (this.words[0] & 1) === 0
            };
            BN.prototype.isOdd = function isOdd() {
                return (this.words[0] & 1) === 1
            };
            BN.prototype.andln = function andln(num) {
                return this.words[0] & num
            };
            BN.prototype.bincn = function bincn(bit) {
                assert(typeof bit === "number");
                var r = bit % 26;
                var s = (bit - r) / 26;
                var q = 1 << r;
                if (this.length <= s) {
                    this._expand(s + 1);
                    this.words[s] |= q;
                    return this
                }
                var carry = q;
                for (var i = s; carry !== 0 && i < this.length; i++) {
                    var w = this.words[i] | 0;
                    w += carry;
                    carry = w >>> 26;
                    w &= 67108863;
                    this.words[i] = w
                }
                if (carry !== 0) {
                    this.words[i] = carry;
                    this.length++
                }
                return this
            };
            BN.prototype.isZero = function isZero() {
                return this.length === 1 && this.words[0] === 0
            };
            BN.prototype.cmpn = function cmpn(num) {
                var negative = num < 0;
                if (this.negative !== 0 && !negative) return -1;
                if (this.negative === 0 && negative) return 1;
                this.strip();
                var res;
                if (this.length > 1) {
                    res = 1
                } else {
                    if (negative) {
                        num = -num
                    }
                    assert(num <= 67108863, "Number is too big");
                    var w = this.words[0] | 0;
                    res = w === num ? 0 : w < num ? -1 : 1
                }
                if (this.negative !== 0) return -res | 0;
                return res
            };
            BN.prototype.cmp = function cmp(num) {
                if (this.negative !== 0 && num.negative === 0) return -1;
                if (this.negative === 0 && num.negative !== 0) return 1;
                var res = this.ucmp(num);
                if (this.negative !== 0) return -res | 0;
                return res
            };
            BN.prototype.ucmp = function ucmp(num) {
                if (this.length > num.length) return 1;
                if (this.length < num.length) return -1;
                var res = 0;
                for (var i = this.length - 1; i >= 0; i--) {
                    var a = this.words[i] | 0;
                    var b = num.words[i] | 0;
                    if (a === b) continue;
                    if (a < b) {
                        res = -1
                    } else if (a > b) {
                        res = 1
                    }
                    break
                }
                return res
            };
            BN.prototype.gtn = function gtn(num) {
                return this.cmpn(num) === 1
            };
            BN.prototype.gt = function gt(num) {
                return this.cmp(num) === 1
            };
            BN.prototype.gten = function gten(num) {
                return this.cmpn(num) >= 0
            };
            BN.prototype.gte = function gte(num) {
                return this.cmp(num) >= 0
            };
            BN.prototype.ltn = function ltn(num) {
                return this.cmpn(num) === -1
            };
            BN.prototype.lt = function lt(num) {
                return this.cmp(num) === -1
            };
            BN.prototype.lten = function lten(num) {
                return this.cmpn(num) <= 0
            };
            BN.prototype.lte = function lte(num) {
                return this.cmp(num) <= 0
            };
            BN.prototype.eqn = function eqn(num) {
                return this.cmpn(num) === 0
            };
            BN.prototype.eq = function eq(num) {
                return this.cmp(num) === 0
            };
            BN.red = function red(num) {
                return new Red(num)
            };
            BN.prototype.toRed = function toRed(ctx) {
                assert(!this.red, "Already a number in reduction context");
                assert(this.negative === 0, "red works only with positives");
                return ctx.convertTo(this)._forceRed(ctx)
            };
            BN.prototype.fromRed = function fromRed() {
                assert(this.red, "fromRed works only with numbers in reduction context");
                return this.red.convertFrom(this)
            };
            BN.prototype._forceRed = function _forceRed(ctx) {
                this.red = ctx;
                return this
            };
            BN.prototype.forceRed = function forceRed(ctx) {
                assert(!this.red, "Already a number in reduction context");
                return this._forceRed(ctx)
            };
            BN.prototype.redAdd = function redAdd(num) {
                assert(this.red, "redAdd works only with red numbers");
                return this.red.add(this, num)
            };
            BN.prototype.redIAdd = function redIAdd(num) {
                assert(this.red, "redIAdd works only with red numbers");
                return this.red.iadd(this, num)
            };
            BN.prototype.redSub = function redSub(num) {
                assert(this.red, "redSub works only with red numbers");
                return this.red.sub(this, num)
            };
            BN.prototype.redISub = function redISub(num) {
                assert(this.red, "redISub works only with red numbers");
                return this.red.isub(this, num)
            };
            BN.prototype.redShl = function redShl(num) {
                assert(this.red, "redShl works only with red numbers");
                return this.red.shl(this, num)
            };
            BN.prototype.redMul = function redMul(num) {
                assert(this.red, "redMul works only with red numbers");
                this.red._verify2(this, num);
                return this.red.mul(this, num)
            };
            BN.prototype.redIMul = function redIMul(num) {
                assert(this.red, "redMul works only with red numbers");
                this.red._verify2(this, num);
                return this.red.imul(this, num)
            };
            BN.prototype.redSqr = function redSqr() {
                assert(this.red, "redSqr works only with red numbers");
                this.red._verify1(this);
                return this.red.sqr(this)
            };
            BN.prototype.redISqr = function redISqr() {
                assert(this.red, "redISqr works only with red numbers");
                this.red._verify1(this);
                return this.red.isqr(this)
            };
            BN.prototype.redSqrt = function redSqrt() {
                assert(this.red, "redSqrt works only with red numbers");
                this.red._verify1(this);
                return this.red.sqrt(this)
            };
            BN.prototype.redInvm = function redInvm() {
                assert(this.red, "redInvm works only with red numbers");
                this.red._verify1(this);
                return this.red.invm(this)
            };
            BN.prototype.redNeg = function redNeg() {
                assert(this.red, "redNeg works only with red numbers");
                this.red._verify1(this);
                return this.red.neg(this)
            };
            BN.prototype.redPow = function redPow(num) {
                assert(this.red && !num.red, "redPow(normalNum)");
                this.red._verify1(this);
                return this.red.pow(this, num)
            };
            var primes = {
                k256: null,
                p224: null,
                p192: null,
                p25519: null
            };

            function MPrime(name, p) {
                this.name = name;
                this.p = new BN(p, 16);
                this.n = this.p.bitLength();
                this.k = new BN(1).iushln(this.n).isub(this.p);
                this.tmp = this._tmp()
            }
            MPrime.prototype._tmp = function _tmp() {
                var tmp = new BN(null);
                tmp.words = new Array(Math.ceil(this.n / 13));
                return tmp
            };
            MPrime.prototype.ireduce = function ireduce(num) {
                var r = num;
                var rlen;
                do {
                    this.split(r, this.tmp);
                    r = this.imulK(r);
                    r = r.iadd(this.tmp);
                    rlen = r.bitLength()
                } while (rlen > this.n);
                var cmp = rlen < this.n ? -1 : r.ucmp(this.p);
                if (cmp === 0) {
                    r.words[0] = 0;
                    r.length = 1
                } else if (cmp > 0) {
                    r.isub(this.p)
                } else {
                    r.strip()
                }
                return r
            };
            MPrime.prototype.split = function split(input, out) {
                input.iushrn(this.n, 0, out)
            };
            MPrime.prototype.imulK = function imulK(num) {
                return num.imul(this.k)
            };

            function K256() {
                MPrime.call(this, "k256", "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f")
            }
            inherits(K256, MPrime);
            K256.prototype.split = function split(input, output) {
                var mask = 4194303;
                var outLen = Math.min(input.length, 9);
                for (var i = 0; i < outLen; i++) {
                    output.words[i] = input.words[i]
                }
                output.length = outLen;
                if (input.length <= 9) {
                    input.words[0] = 0;
                    input.length = 1;
                    return
                }
                var prev = input.words[9];
                output.words[output.length++] = prev & mask;
                for (i = 10; i < input.length; i++) {
                    var next = input.words[i] | 0;
                    input.words[i - 10] = (next & mask) << 4 | prev >>> 22;
                    prev = next
                }
                prev >>>= 22;
                input.words[i - 10] = prev;
                if (prev === 0 && input.length > 10) {
                    input.length -= 10
                } else {
                    input.length -= 9
                }
            };
            K256.prototype.imulK = function imulK(num) {
                num.words[num.length] = 0;
                num.words[num.length + 1] = 0;
                num.length += 2;
                var lo = 0;
                for (var i = 0; i < num.length; i++) {
                    var w = num.words[i] | 0;
                    lo += w * 977;
                    num.words[i] = lo & 67108863;
                    lo = w * 64 + (lo / 67108864 | 0)
                }
                if (num.words[num.length - 1] === 0) {
                    num.length--;
                    if (num.words[num.length - 1] === 0) {
                        num.length--
                    }
                }
                return num
            };

            function P224() {
                MPrime.call(this, "p224", "ffffffff ffffffff ffffffff ffffffff 00000000 00000000 00000001")
            }
            inherits(P224, MPrime);

            function P192() {
                MPrime.call(this, "p192", "ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff")
            }
            inherits(P192, MPrime);

            function P25519() {
                MPrime.call(this, "25519", "7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed")
            }
            inherits(P25519, MPrime);
            P25519.prototype.imulK = function imulK(num) {
                var carry = 0;
                for (var i = 0; i < num.length; i++) {
                    var hi = (num.words[i] | 0) * 19 + carry;
                    var lo = hi & 67108863;
                    hi >>>= 26;
                    num.words[i] = lo;
                    carry = hi
                }
                if (carry !== 0) {
                    num.words[num.length++] = carry
                }
                return num
            };
            BN._prime = function prime(name) {
                if (primes[name]) return primes[name];
                var prime;
                if (name === "k256") {
                    prime = new K256
                } else if (name === "p224") {
                    prime = new P224
                } else if (name === "p192") {
                    prime = new P192
                } else if (name === "p25519") {
                    prime = new P25519
                } else {
                    throw new Error("Unknown prime " + name)
                }
                primes[name] = prime;
                return prime
            };

            function Red(m) {
                if (typeof m === "string") {
                    var prime = BN._prime(m);
                    this.m = prime.p;
                    this.prime = prime
                } else {
                    assert(m.gtn(1), "modulus must be greater than 1");
                    this.m = m;
                    this.prime = null
                }
            }
            Red.prototype._verify1 = function _verify1(a) {
                assert(a.negative === 0, "red works only with positives");
                assert(a.red, "red works only with red numbers")
            };
            Red.prototype._verify2 = function _verify2(a, b) {
                assert((a.negative | b.negative) === 0, "red works only with positives");
                assert(a.red && a.red === b.red, "red works only with red numbers")
            };
            Red.prototype.imod = function imod(a) {
                if (this.prime) return this.prime.ireduce(a)._forceRed(this);
                return a.umod(this.m)._forceRed(this)
            };
            Red.prototype.neg = function neg(a) {
                if (a.isZero()) {
                    return a.clone()
                }
                return this.m.sub(a)._forceRed(this)
            };
            Red.prototype.add = function add(a, b) {
                this._verify2(a, b);
                var res = a.add(b);
                if (res.cmp(this.m) >= 0) {
                    res.isub(this.m)
                }
                return res._forceRed(this)
            };
            Red.prototype.iadd = function iadd(a, b) {
                this._verify2(a, b);
                var res = a.iadd(b);
                if (res.cmp(this.m) >= 0) {
                    res.isub(this.m)
                }
                return res
            };
            Red.prototype.sub = function sub(a, b) {
                this._verify2(a, b);
                var res = a.sub(b);
                if (res.cmpn(0) < 0) {
                    res.iadd(this.m)
                }
                return res._forceRed(this)
            };
            Red.prototype.isub = function isub(a, b) {
                this._verify2(a, b);
                var res = a.isub(b);
                if (res.cmpn(0) < 0) {
                    res.iadd(this.m)
                }
                return res
            };
            Red.prototype.shl = function shl(a, num) {
                this._verify1(a);
                return this.imod(a.ushln(num))
            };
            Red.prototype.imul = function imul(a, b) {
                this._verify2(a, b);
                return this.imod(a.imul(b))
            };
            Red.prototype.mul = function mul(a, b) {
                this._verify2(a, b);
                return this.imod(a.mul(b))
            };
            Red.prototype.isqr = function isqr(a) {
                return this.imul(a, a.clone())
            };
            Red.prototype.sqr = function sqr(a) {
                return this.mul(a, a)
            };
            Red.prototype.sqrt = function sqrt(a) {
                if (a.isZero()) return a.clone();
                var mod3 = this.m.andln(3);
                assert(mod3 % 2 === 1);
                if (mod3 === 3) {
                    var pow = this.m.add(new BN(1)).iushrn(2);
                    return this.pow(a, pow)
                }
                var q = this.m.subn(1);
                var s = 0;
                while (!q.isZero() && q.andln(1) === 0) {
                    s++;
                    q.iushrn(1)
                }
                assert(!q.isZero());
                var one = new BN(1).toRed(this);
                var nOne = one.redNeg();
                var lpow = this.m.subn(1).iushrn(1);
                var z = this.m.bitLength();
                z = new BN(2 * z * z).toRed(this);
                while (this.pow(z, lpow).cmp(nOne) !== 0) {
                    z.redIAdd(nOne)
                }
                var c = this.pow(z, q);
                var r = this.pow(a, q.addn(1).iushrn(1));
                var t = this.pow(a, q);
                var m = s;
                while (t.cmp(one) !== 0) {
                    var tmp = t;
                    for (var i = 0; tmp.cmp(one) !== 0; i++) {
                        tmp = tmp.redSqr()
                    }
                    assert(i < m);
                    var b = this.pow(c, new BN(1).iushln(m - i - 1));
                    r = r.redMul(b);
                    c = b.redSqr();
                    t = t.redMul(c);
                    m = i
                }
                return r
            };
            Red.prototype.invm = function invm(a) {
                var inv = a._invmp(this.m);
                if (inv.negative !== 0) {
                    inv.negative = 0;
                    return this.imod(inv).redNeg()
                } else {
                    return this.imod(inv)
                }
            };
            Red.prototype.pow = function pow(a, num) {
                if (num.isZero()) return new BN(1);
                if (num.cmpn(1) === 0) return a.clone();
                var windowSize = 4;
                var wnd = new Array(1 << windowSize);
                wnd[0] = new BN(1).toRed(this);
                wnd[1] = a;
                for (var i = 2; i < wnd.length; i++) {
                    wnd[i] = this.mul(wnd[i - 1], a)
                }
                var res = wnd[0];
                var current = 0;
                var currentLen = 0;
                var start = num.bitLength() % 26;
                if (start === 0) {
                    start = 26
                }
                for (i = num.length - 1; i >= 0; i--) {
                    var word = num.words[i];
                    for (var j = start - 1; j >= 0; j--) {
                        var bit = word >> j & 1;
                        if (res !== wnd[0]) {
                            res = this.sqr(res)
                        }
                        if (bit === 0 && current === 0) {
                            currentLen = 0;
                            continue
                        }
                        current <<= 1;
                        current |= bit;
                        currentLen++;
                        if (currentLen !== windowSize && (i !== 0 || j !== 0)) continue;
                        res = this.mul(res, wnd[current]);
                        currentLen = 0;
                        current = 0
                    }
                    start = 26
                }
                return res
            };
            Red.prototype.convertTo = function convertTo(num) {
                var r = num.umod(this.m);
                return r === num ? r.clone() : r
            };
            Red.prototype.convertFrom = function convertFrom(num) {
                var res = num.clone();
                res.red = null;
                return res
            };
            BN.mont = function mont(num) {
                return new Mont(num)
            };

            function Mont(m) {
                Red.call(this, m);
                this.shift = this.m.bitLength();
                if (this.shift % 26 !== 0) {
                    this.shift += 26 - this.shift % 26
                }
                this.r = new BN(1).iushln(this.shift);
                this.r2 = this.imod(this.r.sqr());
                this.rinv = this.r._invmp(this.m);
                this.minv = this.rinv.mul(this.r).isubn(1).div(this.m);
                this.minv = this.minv.umod(this.r);
                this.minv = this.r.sub(this.minv)
            }
            inherits(Mont, Red);
            Mont.prototype.convertTo = function convertTo(num) {
                return this.imod(num.ushln(this.shift))
            };
            Mont.prototype.convertFrom = function convertFrom(num) {
                var r = this.imod(num.mul(this.rinv));
                r.red = null;
                return r
            };
            Mont.prototype.imul = function imul(a, b) {
                if (a.isZero() || b.isZero()) {
                    a.words[0] = 0;
                    a.length = 1;
                    return a
                }
                var t = a.imul(b);
                var c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
                var u = t.isub(c).iushrn(this.shift);
                var res = u;
                if (u.cmp(this.m) >= 0) {
                    res = u.isub(this.m)
                } else if (u.cmpn(0) < 0) {
                    res = u.iadd(this.m)
                }
                return res._forceRed(this)
            };
            Mont.prototype.mul = function mul(a, b) {
                if (a.isZero() || b.isZero()) return new BN(0)._forceRed(this);
                var t = a.mul(b);
                var c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
                var u = t.isub(c).iushrn(this.shift);
                var res = u;
                if (u.cmp(this.m) >= 0) {
                    res = u.isub(this.m)
                } else if (u.cmpn(0) < 0) {
                    res = u.iadd(this.m)
                }
                return res._forceRed(this)
            };
            Mont.prototype.invm = function invm(a) {
                var res = this.imod(a._invmp(this.m).mul(this.r2));
                return res._forceRed(this)
            }
        })(typeof module === "undefined" || module, this)
    }, {}],
    45: [function (require, module, exports) {}, {}],
    46: [function (require, module, exports) {
        "use strict";
        var base64 = require("base64-js");
        var ieee754 = require("ieee754");
        exports.Buffer = Buffer;
        exports.SlowBuffer = SlowBuffer;
        exports.INSPECT_MAX_BYTES = 50;
        var K_MAX_LENGTH = 2147483647;
        exports.kMaxLength = K_MAX_LENGTH;
        Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport();
        if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
            console.error("This browser lacks typed array (Uint8Array) support which is required by " + "`buffer` v5.x. Use `buffer` v4.x if you require old browser support.")
        }

        function typedArraySupport() {
            try {
                var arr = new Uint8Array(1);
                arr.__proto__ = {
                    __proto__: Uint8Array.prototype,
                    foo: function () {
                        return 42
                    }
                };
                return arr.foo() === 42
            } catch (e) {
                return false
            }
        }
        Object.defineProperty(Buffer.prototype, "parent", {
            get: function () {
                if (!(this instanceof Buffer)) {
                    return undefined
                }
                return this.buffer
            }
        });
        Object.defineProperty(Buffer.prototype, "offset", {
            get: function () {
                if (!(this instanceof Buffer)) {
                    return undefined
                }
                return this.byteOffset
            }
        });

        function createBuffer(length) {
            if (length > K_MAX_LENGTH) {
                throw new RangeError("Invalid typed array length")
            }
            var buf = new Uint8Array(length);
            buf.__proto__ = Buffer.prototype;
            return buf
        }

        function Buffer(arg, encodingOrOffset, length) {
            if (typeof arg === "number") {
                if (typeof encodingOrOffset === "string") {
                    throw new Error("If encoding is specified then the first argument must be a string")
                }
                return allocUnsafe(arg)
            }
            return from(arg, encodingOrOffset, length)
        }
        if (typeof Symbol !== "undefined" && Symbol.species && Buffer[Symbol.species] === Buffer) {
            Object.defineProperty(Buffer, Symbol.species, {
                value: null,
                configurable: true,
                enumerable: false,
                writable: false
            })
        }
        Buffer.poolSize = 8192;

        function from(value, encodingOrOffset, length) {
            if (typeof value === "number") {
                throw new TypeError('"value" argument must not be a number')
            }
            if (isArrayBuffer(value) || value && isArrayBuffer(value.buffer)) {
                return fromArrayBuffer(value, encodingOrOffset, length)
            }
            if (typeof value === "string") {
                return fromString(value, encodingOrOffset)
            }
            return fromObject(value)
        }
        Buffer.from = function (value, encodingOrOffset, length) {
            return from(value, encodingOrOffset, length)
        };
        Buffer.prototype.__proto__ = Uint8Array.prototype;
        Buffer.__proto__ = Uint8Array;

        function assertSize(size) {
            if (typeof size !== "number") {
                throw new TypeError('"size" argument must be of type number')
            } else if (size < 0) {
                throw new RangeError('"size" argument must not be negative')
            }
        }

        function alloc(size, fill, encoding) {
            assertSize(size);
            if (size <= 0) {
                return createBuffer(size)
            }
            if (fill !== undefined) {
                return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill)
            }
            return createBuffer(size)
        }
        Buffer.alloc = function (size, fill, encoding) {
            return alloc(size, fill, encoding)
        };

        function allocUnsafe(size) {
            assertSize(size);
            return createBuffer(size < 0 ? 0 : checked(size) | 0)
        }
        Buffer.allocUnsafe = function (size) {
            return allocUnsafe(size)
        };
        Buffer.allocUnsafeSlow = function (size) {
            return allocUnsafe(size)
        };

        function fromString(string, encoding) {
            if (typeof encoding !== "string" || encoding === "") {
                encoding = "utf8"
            }
            if (!Buffer.isEncoding(encoding)) {
                throw new TypeError("Unknown encoding: " + encoding)
            }
            var length = byteLength(string, encoding) | 0;
            var buf = createBuffer(length);
            var actual = buf.write(string, encoding);
            if (actual !== length) {
                buf = buf.slice(0, actual)
            }
            return buf
        }

        function fromArrayLike(array) {
            var length = array.length < 0 ? 0 : checked(array.length) | 0;
            var buf = createBuffer(length);
            for (var i = 0; i < length; i += 1) {
                buf[i] = array[i] & 255
            }
            return buf
        }

        function fromArrayBuffer(array, byteOffset, length) {
            if (byteOffset < 0 || array.byteLength < byteOffset) {
                throw new RangeError('"offset" is outside of buffer bounds')
            }
            if (array.byteLength < byteOffset + (length || 0)) {
                throw new RangeError('"length" is outside of buffer bounds')
            }
            var buf;
            if (byteOffset === undefined && length === undefined) {
                buf = new Uint8Array(array)
            } else if (length === undefined) {
                buf = new Uint8Array(array, byteOffset)
            } else {
                buf = new Uint8Array(array, byteOffset, length)
            }
            buf.__proto__ = Buffer.prototype;
            return buf
        }

        function fromObject(obj) {
            if (Buffer.isBuffer(obj)) {
                var len = checked(obj.length) | 0;
                var buf = createBuffer(len);
                if (buf.length === 0) {
                    return buf
                }
                obj.copy(buf, 0, 0, len);
                return buf
            }
            if (obj) {
                if (ArrayBuffer.isView(obj) || "length" in obj) {
                    if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
                        return createBuffer(0)
                    }
                    return fromArrayLike(obj)
                }
                if (obj.type === "Buffer" && Array.isArray(obj.data)) {
                    return fromArrayLike(obj.data)
                }
            }
            throw new TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object.")
        }

        function checked(length) {
            if (length >= K_MAX_LENGTH) {
                throw new RangeError("Attempt to allocate Buffer larger than maximum " + "size: 0x" + K_MAX_LENGTH.toString(16) + " bytes")
            }
            return length | 0
        }

        function SlowBuffer(length) {
            if (+length != length) {
                length = 0
            }
            return Buffer.alloc(+length)
        }
        Buffer.isBuffer = function isBuffer(b) {
            return b != null && b._isBuffer === true
        };
        Buffer.compare = function compare(a, b) {
            if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
                throw new TypeError("Arguments must be Buffers")
            }
            if (a === b) return 0;
            var x = a.length;
            var y = b.length;
            for (var i = 0, len = Math.min(x, y); i < len; ++i) {
                if (a[i] !== b[i]) {
                    x = a[i];
                    y = b[i];
                    break
                }
            }
            if (x < y) return -1;
            if (y < x) return 1;
            return 0
        };
        Buffer.isEncoding = function isEncoding(encoding) {
            switch (String(encoding).toLowerCase()) {
                case "hex":
                case "utf8":
                case "utf-8":
                case "ascii":
                case "latin1":
                case "binary":
                case "base64":
                case "ucs2":
                case "ucs-2":
                case "utf16le":
                case "utf-16le":
                    return true;
                default:
                    return false
            }
        };
        Buffer.concat = function concat(list, length) {
            if (!Array.isArray(list)) {
                throw new TypeError('"list" argument must be an Array of Buffers')
            }
            if (list.length === 0) {
                return Buffer.alloc(0)
            }
            var i;
            if (length === undefined) {
                length = 0;
                for (i = 0; i < list.length; ++i) {
                    length += list[i].length
                }
            }
            var buffer = Buffer.allocUnsafe(length);
            var pos = 0;
            for (i = 0; i < list.length; ++i) {
                var buf = list[i];
                if (ArrayBuffer.isView(buf)) {
                    buf = Buffer.from(buf)
                }
                if (!Buffer.isBuffer(buf)) {
                    throw new TypeError('"list" argument must be an Array of Buffers')
                }
                buf.copy(buffer, pos);
                pos += buf.length
            }
            return buffer
        };

        function byteLength(string, encoding) {
            if (Buffer.isBuffer(string)) {
                return string.length
            }
            if (ArrayBuffer.isView(string) || isArrayBuffer(string)) {
                return string.byteLength
            }
            if (typeof string !== "string") {
                string = "" + string
            }
            var len = string.length;
            if (len === 0) return 0;
            var loweredCase = false;
            for (;;) {
                switch (encoding) {
                    case "ascii":
                    case "latin1":
                    case "binary":
                        return len;
                    case "utf8":
                    case "utf-8":
                    case undefined:
                        return utf8ToBytes(string).length;
                    case "ucs2":
                    case "ucs-2":
                    case "utf16le":
                    case "utf-16le":
                        return len * 2;
                    case "hex":
                        return len >>> 1;
                    case "base64":
                        return base64ToBytes(string).length;
                    default:
                        if (loweredCase) return utf8ToBytes(string).length;
                        encoding = ("" + encoding).toLowerCase();
                        loweredCase = true
                }
            }
        }
        Buffer.byteLength = byteLength;

        function slowToString(encoding, start, end) {
            var loweredCase = false;
            if (start === undefined || start < 0) {
                start = 0
            }
            if (start > this.length) {
                return ""
            }
            if (end === undefined || end > this.length) {
                end = this.length
            }
            if (end <= 0) {
                return ""
            }
            end >>>= 0;
            start >>>= 0;
            if (end <= start) {
                return ""
            }
            if (!encoding) encoding = "utf8";
            while (true) {
                switch (encoding) {
                    case "hex":
                        return hexSlice(this, start, end);
                    case "utf8":
                    case "utf-8":
                        return utf8Slice(this, start, end);
                    case "ascii":
                        return asciiSlice(this, start, end);
                    case "latin1":
                    case "binary":
                        return latin1Slice(this, start, end);
                    case "base64":
                        return base64Slice(this, start, end);
                    case "ucs2":
                    case "ucs-2":
                    case "utf16le":
                    case "utf-16le":
                        return utf16leSlice(this, start, end);
                    default:
                        if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
                        encoding = (encoding + "").toLowerCase();
                        loweredCase = true
                }
            }
        }
        Buffer.prototype._isBuffer = true;

        function swap(b, n, m) {
            var i = b[n];
            b[n] = b[m];
            b[m] = i
        }
        Buffer.prototype.swap16 = function swap16() {
            var len = this.length;
            if (len % 2 !== 0) {
                throw new RangeError("Buffer size must be a multiple of 16-bits")
            }
            for (var i = 0; i < len; i += 2) {
                swap(this, i, i + 1)
            }
            return this
        };
        Buffer.prototype.swap32 = function swap32() {
            var len = this.length;
            if (len % 4 !== 0) {
                throw new RangeError("Buffer size must be a multiple of 32-bits")
            }
            for (var i = 0; i < len; i += 4) {
                swap(this, i, i + 3);
                swap(this, i + 1, i + 2)
            }
            return this
        };
        Buffer.prototype.swap64 = function swap64() {
            var len = this.length;
            if (len % 8 !== 0) {
                throw new RangeError("Buffer size must be a multiple of 64-bits")
            }
            for (var i = 0; i < len; i += 8) {
                swap(this, i, i + 7);
                swap(this, i + 1, i + 6);
                swap(this, i + 2, i + 5);
                swap(this, i + 3, i + 4)
            }
            return this
        };
        Buffer.prototype.toString = function toString() {
            var length = this.length;
            if (length === 0) return "";
            if (arguments.length === 0) return utf8Slice(this, 0, length);
            return slowToString.apply(this, arguments)
        };
        Buffer.prototype.toLocaleString = Buffer.prototype.toString;
        Buffer.prototype.equals = function equals(b) {
            if (!Buffer.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
            if (this === b) return true;
            return Buffer.compare(this, b) === 0
        };
        Buffer.prototype.inspect = function inspect() {
            var str = "";
            var max = exports.INSPECT_MAX_BYTES;
            if (this.length > 0) {
                str = this.toString("hex", 0, max).match(/.{2}/g).join(" ");
                if (this.length > max) str += " ... "
            }
            return "<Buffer " + str + ">"
        };
        Buffer.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
            if (!Buffer.isBuffer(target)) {
                throw new TypeError("Argument must be a Buffer")
            }
            if (start === undefined) {
                start = 0
            }
            if (end === undefined) {
                end = target ? target.length : 0
            }
            if (thisStart === undefined) {
                thisStart = 0
            }
            if (thisEnd === undefined) {
                thisEnd = this.length
            }
            if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
                throw new RangeError("out of range index")
            }
            if (thisStart >= thisEnd && start >= end) {
                return 0
            }
            if (thisStart >= thisEnd) {
                return -1
            }
            if (start >= end) {
                return 1
            }
            start >>>= 0;
            end >>>= 0;
            thisStart >>>= 0;
            thisEnd >>>= 0;
            if (this === target) return 0;
            var x = thisEnd - thisStart;
            var y = end - start;
            var len = Math.min(x, y);
            var thisCopy = this.slice(thisStart, thisEnd);
            var targetCopy = target.slice(start, end);
            for (var i = 0; i < len; ++i) {
                if (thisCopy[i] !== targetCopy[i]) {
                    x = thisCopy[i];
                    y = targetCopy[i];
                    break
                }
            }
            if (x < y) return -1;
            if (y < x) return 1;
            return 0
        };

        function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
            if (buffer.length === 0) return -1;
            if (typeof byteOffset === "string") {
                encoding = byteOffset;
                byteOffset = 0
            } else if (byteOffset > 2147483647) {
                byteOffset = 2147483647
            } else if (byteOffset < -2147483648) {
                byteOffset = -2147483648
            }
            byteOffset = +byteOffset;
            if (numberIsNaN(byteOffset)) {
                byteOffset = dir ? 0 : buffer.length - 1
            }
            if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
            if (byteOffset >= buffer.length) {
                if (dir) return -1;
                else byteOffset = buffer.length - 1
            } else if (byteOffset < 0) {
                if (dir) byteOffset = 0;
                else return -1
            }
            if (typeof val === "string") {
                val = Buffer.from(val, encoding)
            }
            if (Buffer.isBuffer(val)) {
                if (val.length === 0) {
                    return -1
                }
                return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
            } else if (typeof val === "number") {
                val = val & 255;
                if (typeof Uint8Array.prototype.indexOf === "function") {
                    if (dir) {
                        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
                    } else {
                        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
                    }
                }
                return arrayIndexOf(buffer, [val], byteOffset, encoding, dir)
            }
            throw new TypeError("val must be string, number or Buffer")
        }

        function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
            var indexSize = 1;
            var arrLength = arr.length;
            var valLength = val.length;
            if (encoding !== undefined) {
                encoding = String(encoding).toLowerCase();
                if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
                    if (arr.length < 2 || val.length < 2) {
                        return -1
                    }
                    indexSize = 2;
                    arrLength /= 2;
                    valLength /= 2;
                    byteOffset /= 2
                }
            }

            function read(buf, i) {
                if (indexSize === 1) {
                    return buf[i]
                } else {
                    return buf.readUInt16BE(i * indexSize)
                }
            }
            var i;
            if (dir) {
                var foundIndex = -1;
                for (i = byteOffset; i < arrLength; i++) {
                    if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
                        if (foundIndex === -1) foundIndex = i;
                        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
                    } else {
                        if (foundIndex !== -1) i -= i - foundIndex;
                        foundIndex = -1
                    }
                }
            } else {
                if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
                for (i = byteOffset; i >= 0; i--) {
                    var found = true;
                    for (var j = 0; j < valLength; j++) {
                        if (read(arr, i + j) !== read(val, j)) {
                            found = false;
                            break
                        }
                    }
                    if (found) return i
                }
            }
            return -1
        }
        Buffer.prototype.includes = function includes(val, byteOffset, encoding) {
            return this.indexOf(val, byteOffset, encoding) !== -1
        };
        Buffer.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
            return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
        };
        Buffer.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
            return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
        };

        function hexWrite(buf, string, offset, length) {
            offset = Number(offset) || 0;
            var remaining = buf.length - offset;
            if (!length) {
                length = remaining
            } else {
                length = Number(length);
                if (length > remaining) {
                    length = remaining
                }
            }
            var strLen = string.length;
            if (length > strLen / 2) {
                length = strLen / 2
            }
            for (var i = 0; i < length; ++i) {
                var parsed = parseInt(string.substr(i * 2, 2), 16);
                if (numberIsNaN(parsed)) return i;
                buf[offset + i] = parsed
            }
            return i
        }

        function utf8Write(buf, string, offset, length) {
            return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
        }

        function asciiWrite(buf, string, offset, length) {
            return blitBuffer(asciiToBytes(string), buf, offset, length)
        }

        function latin1Write(buf, string, offset, length) {
            return asciiWrite(buf, string, offset, length)
        }

        function base64Write(buf, string, offset, length) {
            return blitBuffer(base64ToBytes(string), buf, offset, length)
        }

        function ucs2Write(buf, string, offset, length) {
            return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
        }
        Buffer.prototype.write = function write(string, offset, length, encoding) {
            if (offset === undefined) {
                encoding = "utf8";
                length = this.length;
                offset = 0
            } else if (length === undefined && typeof offset === "string") {
                encoding = offset;
                length = this.length;
                offset = 0
            } else if (isFinite(offset)) {
                offset = offset >>> 0;
                if (isFinite(length)) {
                    length = length >>> 0;
                    if (encoding === undefined) encoding = "utf8"
                } else {
                    encoding = length;
                    length = undefined
                }
            } else {
                throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported")
            }
            var remaining = this.length - offset;
            if (length === undefined || length > remaining) length = remaining;
            if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
                throw new RangeError("Attempt to write outside buffer bounds")
            }
            if (!encoding) encoding = "utf8";
            var loweredCase = false;
            for (;;) {
                switch (encoding) {
                    case "hex":
                        return hexWrite(this, string, offset, length);
                    case "utf8":
                    case "utf-8":
                        return utf8Write(this, string, offset, length);
                    case "ascii":
                        return asciiWrite(this, string, offset, length);
                    case "latin1":
                    case "binary":
                        return latin1Write(this, string, offset, length);
                    case "base64":
                        return base64Write(this, string, offset, length);
                    case "ucs2":
                    case "ucs-2":
                    case "utf16le":
                    case "utf-16le":
                        return ucs2Write(this, string, offset, length);
                    default:
                        if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
                        encoding = ("" + encoding).toLowerCase();
                        loweredCase = true
                }
            }
        };
        Buffer.prototype.toJSON = function toJSON() {
            return {
                type: "Buffer",
                data: Array.prototype.slice.call(this._arr || this, 0)
            }
        };

        function base64Slice(buf, start, end) {
            if (start === 0 && end === buf.length) {
                return base64.fromByteArray(buf)
            } else {
                return base64.fromByteArray(buf.slice(start, end))
            }
        }

        function utf8Slice(buf, start, end) {
            end = Math.min(buf.length, end);
            var res = [];
            var i = start;
            while (i < end) {
                var firstByte = buf[i];
                var codePoint = null;
                var bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
                if (i + bytesPerSequence <= end) {
                    var secondByte, thirdByte, fourthByte, tempCodePoint;
                    switch (bytesPerSequence) {
                        case 1:
                            if (firstByte < 128) {
                                codePoint = firstByte
                            }
                            break;
                        case 2:
                            secondByte = buf[i + 1];
                            if ((secondByte & 192) === 128) {
                                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                                if (tempCodePoint > 127) {
                                    codePoint = tempCodePoint
                                }
                            }
                            break;
                        case 3:
                            secondByte = buf[i + 1];
                            thirdByte = buf[i + 2];
                            if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                                    codePoint = tempCodePoint
                                }
                            }
                            break;
                        case 4:
                            secondByte = buf[i + 1];
                            thirdByte = buf[i + 2];
                            fourthByte = buf[i + 3];
                            if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                                    codePoint = tempCodePoint
                                }
                            }
                    }
                }
                if (codePoint === null) {
                    codePoint = 65533;
                    bytesPerSequence = 1
                } else if (codePoint > 65535) {
                    codePoint -= 65536;
                    res.push(codePoint >>> 10 & 1023 | 55296);
                    codePoint = 56320 | codePoint & 1023
                }
                res.push(codePoint);
                i += bytesPerSequence
            }
            return decodeCodePointsArray(res)
        }
        var MAX_ARGUMENTS_LENGTH = 4096;

        function decodeCodePointsArray(codePoints) {
            var len = codePoints.length;
            if (len <= MAX_ARGUMENTS_LENGTH) {
                return String.fromCharCode.apply(String, codePoints)
            }
            var res = "";
            var i = 0;
            while (i < len) {
                res += String.fromCharCode.apply(String, codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH))
            }
            return res
        }

        function asciiSlice(buf, start, end) {
            var ret = "";
            end = Math.min(buf.length, end);
            for (var i = start; i < end; ++i) {
                ret += String.fromCharCode(buf[i] & 127)
            }
            return ret
        }

        function latin1Slice(buf, start, end) {
            var ret = "";
            end = Math.min(buf.length, end);
            for (var i = start; i < end; ++i) {
                ret += String.fromCharCode(buf[i])
            }
            return ret
        }

        function hexSlice(buf, start, end) {
            var len = buf.length;
            if (!start || start < 0) start = 0;
            if (!end || end < 0 || end > len) end = len;
            var out = "";
            for (var i = start; i < end; ++i) {
                out += toHex(buf[i])
            }
            return out
        }

        function utf16leSlice(buf, start, end) {
            var bytes = buf.slice(start, end);
            var res = "";
            for (var i = 0; i < bytes.length; i += 2) {
                res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
            }
            return res
        }
        Buffer.prototype.slice = function slice(start, end) {
            var len = this.length;
            start = ~~start;
            end = end === undefined ? len : ~~end;
            if (start < 0) {
                start += len;
                if (start < 0) start = 0
            } else if (start > len) {
                start = len
            }
            if (end < 0) {
                end += len;
                if (end < 0) end = 0
            } else if (end > len) {
                end = len
            }
            if (end < start) end = start;
            var newBuf = this.subarray(start, end);
            newBuf.__proto__ = Buffer.prototype;
            return newBuf
        };

        function checkOffset(offset, ext, length) {
            if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
            if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length")
        }
        Buffer.prototype.readUIntLE = function readUIntLE(offset, byteLength, noAssert) {
            offset = offset >>> 0;
            byteLength = byteLength >>> 0;
            if (!noAssert) checkOffset(offset, byteLength, this.length);
            var val = this[offset];
            var mul = 1;
            var i = 0;
            while (++i < byteLength && (mul *= 256)) {
                val += this[offset + i] * mul
            }
            return val
        };
        Buffer.prototype.readUIntBE = function readUIntBE(offset, byteLength, noAssert) {
            offset = offset >>> 0;
            byteLength = byteLength >>> 0;
            if (!noAssert) {
                checkOffset(offset, byteLength, this.length)
            }
            var val = this[offset + --byteLength];
            var mul = 1;
            while (byteLength > 0 && (mul *= 256)) {
                val += this[offset + --byteLength] * mul
            }
            return val
        };
        Buffer.prototype.readUInt8 = function readUInt8(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 1, this.length);
            return this[offset]
        };
        Buffer.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 2, this.length);
            return this[offset] | this[offset + 1] << 8
        };
        Buffer.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 2, this.length);
            return this[offset] << 8 | this[offset + 1]
        };
        Buffer.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 4, this.length);
            return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216
        };
        Buffer.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 4, this.length);
            return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3])
        };
        Buffer.prototype.readIntLE = function readIntLE(offset, byteLength, noAssert) {
            offset = offset >>> 0;
            byteLength = byteLength >>> 0;
            if (!noAssert) checkOffset(offset, byteLength, this.length);
            var val = this[offset];
            var mul = 1;
            var i = 0;
            while (++i < byteLength && (mul *= 256)) {
                val += this[offset + i] * mul
            }
            mul *= 128;
            if (val >= mul) val -= Math.pow(2, 8 * byteLength);
            return val
        };
        Buffer.prototype.readIntBE = function readIntBE(offset, byteLength, noAssert) {
            offset = offset >>> 0;
            byteLength = byteLength >>> 0;
            if (!noAssert) checkOffset(offset, byteLength, this.length);
            var i = byteLength;
            var mul = 1;
            var val = this[offset + --i];
            while (i > 0 && (mul *= 256)) {
                val += this[offset + --i] * mul
            }
            mul *= 128;
            if (val >= mul) val -= Math.pow(2, 8 * byteLength);
            return val
        };
        Buffer.prototype.readInt8 = function readInt8(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 1, this.length);
            if (!(this[offset] & 128)) return this[offset];
            return (255 - this[offset] + 1) * -1
        };
        Buffer.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 2, this.length);
            var val = this[offset] | this[offset + 1] << 8;
            return val & 32768 ? val | 4294901760 : val
        };
        Buffer.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 2, this.length);
            var val = this[offset + 1] | this[offset] << 8;
            return val & 32768 ? val | 4294901760 : val
        };
        Buffer.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 4, this.length);
            return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24
        };
        Buffer.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 4, this.length);
            return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]
        };
        Buffer.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 4, this.length);
            return ieee754.read(this, offset, true, 23, 4)
        };
        Buffer.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 4, this.length);
            return ieee754.read(this, offset, false, 23, 4)
        };
        Buffer.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 8, this.length);
            return ieee754.read(this, offset, true, 52, 8)
        };
        Buffer.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
            offset = offset >>> 0;
            if (!noAssert) checkOffset(offset, 8, this.length);
            return ieee754.read(this, offset, false, 52, 8)
        };

        function checkInt(buf, value, offset, ext, max, min) {
            if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
            if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
            if (offset + ext > buf.length) throw new RangeError("Index out of range")
        }
        Buffer.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength, noAssert) {
            value = +value;
            offset = offset >>> 0;
            byteLength = byteLength >>> 0;
            if (!noAssert) {
                var maxBytes = Math.pow(2, 8 * byteLength) - 1;
                checkInt(this, value, offset, byteLength, maxBytes, 0)
            }
            var mul = 1;
            var i = 0;
            this[offset] = value & 255;
            while (++i < byteLength && (mul *= 256)) {
                this[offset + i] = value / mul & 255
            }
            return offset + byteLength
        };
        Buffer.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength, noAssert) {
            value = +value;
            offset = offset >>> 0;
            byteLength = byteLength >>> 0;
            if (!noAssert) {
                var maxBytes = Math.pow(2, 8 * byteLength) - 1;
                checkInt(this, value, offset, byteLength, maxBytes, 0)
            }
            var i = byteLength - 1;
            var mul = 1;
            this[offset + i] = value & 255;
            while (--i >= 0 && (mul *= 256)) {
                this[offset + i] = value / mul & 255
            }
            return offset + byteLength
        };
        Buffer.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
            this[offset] = value & 255;
            return offset + 1
        };
        Buffer.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
            this[offset] = value & 255;
            this[offset + 1] = value >>> 8;
            return offset + 2
        };
        Buffer.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
            this[offset] = value >>> 8;
            this[offset + 1] = value & 255;
            return offset + 2
        };
        Buffer.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
            this[offset + 3] = value >>> 24;
            this[offset + 2] = value >>> 16;
            this[offset + 1] = value >>> 8;
            this[offset] = value & 255;
            return offset + 4
        };
        Buffer.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
            this[offset] = value >>> 24;
            this[offset + 1] = value >>> 16;
            this[offset + 2] = value >>> 8;
            this[offset + 3] = value & 255;
            return offset + 4
        };
        Buffer.prototype.writeIntLE = function writeIntLE(value, offset, byteLength, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) {
                var limit = Math.pow(2, 8 * byteLength - 1);
                checkInt(this, value, offset, byteLength, limit - 1, -limit)
            }
            var i = 0;
            var mul = 1;
            var sub = 0;
            this[offset] = value & 255;
            while (++i < byteLength && (mul *= 256)) {
                if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
                    sub = 1
                }
                this[offset + i] = (value / mul >> 0) - sub & 255
            }
            return offset + byteLength
        };
        Buffer.prototype.writeIntBE = function writeIntBE(value, offset, byteLength, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) {
                var limit = Math.pow(2, 8 * byteLength - 1);
                checkInt(this, value, offset, byteLength, limit - 1, -limit)
            }
            var i = byteLength - 1;
            var mul = 1;
            var sub = 0;
            this[offset + i] = value & 255;
            while (--i >= 0 && (mul *= 256)) {
                if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
                    sub = 1
                }
                this[offset + i] = (value / mul >> 0) - sub & 255
            }
            return offset + byteLength
        };
        Buffer.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
            if (value < 0) value = 255 + value + 1;
            this[offset] = value & 255;
            return offset + 1
        };
        Buffer.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
            this[offset] = value & 255;
            this[offset + 1] = value >>> 8;
            return offset + 2
        };
        Buffer.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
            this[offset] = value >>> 8;
            this[offset + 1] = value & 255;
            return offset + 2
        };
        Buffer.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
            this[offset] = value & 255;
            this[offset + 1] = value >>> 8;
            this[offset + 2] = value >>> 16;
            this[offset + 3] = value >>> 24;
            return offset + 4
        };
        Buffer.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
            if (value < 0) value = 4294967295 + value + 1;
            this[offset] = value >>> 24;
            this[offset + 1] = value >>> 16;
            this[offset + 2] = value >>> 8;
            this[offset + 3] = value & 255;
            return offset + 4
        };

        function checkIEEE754(buf, value, offset, ext, max, min) {
            if (offset + ext > buf.length) throw new RangeError("Index out of range");
            if (offset < 0) throw new RangeError("Index out of range")
        }

        function writeFloat(buf, value, offset, littleEndian, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) {
                checkIEEE754(buf, value, offset, 4, 3.4028234663852886e38, -3.4028234663852886e38)
            }
            ieee754.write(buf, value, offset, littleEndian, 23, 4);
            return offset + 4
        }
        Buffer.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
            return writeFloat(this, value, offset, true, noAssert)
        };
        Buffer.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
            return writeFloat(this, value, offset, false, noAssert)
        };

        function writeDouble(buf, value, offset, littleEndian, noAssert) {
            value = +value;
            offset = offset >>> 0;
            if (!noAssert) {
                checkIEEE754(buf, value, offset, 8, 1.7976931348623157e308, -1.7976931348623157e308)
            }
            ieee754.write(buf, value, offset, littleEndian, 52, 8);
            return offset + 8
        }
        Buffer.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
            return writeDouble(this, value, offset, true, noAssert)
        };
        Buffer.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
            return writeDouble(this, value, offset, false, noAssert)
        };
        Buffer.prototype.copy = function copy(target, targetStart, start, end) {
            if (!Buffer.isBuffer(target)) throw new TypeError("argument should be a Buffer");
            if (!start) start = 0;
            if (!end && end !== 0) end = this.length;
            if (targetStart >= target.length) targetStart = target.length;
            if (!targetStart) targetStart = 0;
            if (end > 0 && end < start) end = start;
            if (end === start) return 0;
            if (target.length === 0 || this.length === 0) return 0;
            if (targetStart < 0) {
                throw new RangeError("targetStart out of bounds")
            }
            if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
            if (end < 0) throw new RangeError("sourceEnd out of bounds");
            if (end > this.length) end = this.length;
            if (target.length - targetStart < end - start) {
                end = target.length - targetStart + start
            }
            var len = end - start;
            if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
                this.copyWithin(targetStart, start, end)
            } else if (this === target && start < targetStart && targetStart < end) {
                for (var i = len - 1; i >= 0; --i) {
                    target[i + targetStart] = this[i + start]
                }
            } else {
                Uint8Array.prototype.set.call(target, this.subarray(start, end), targetStart)
            }
            return len
        };
        Buffer.prototype.fill = function fill(val, start, end, encoding) {
            if (typeof val === "string") {
                if (typeof start === "string") {
                    encoding = start;
                    start = 0;
                    end = this.length
                } else if (typeof end === "string") {
                    encoding = end;
                    end = this.length
                }
                if (encoding !== undefined && typeof encoding !== "string") {
                    throw new TypeError("encoding must be a string")
                }
                if (typeof encoding === "string" && !Buffer.isEncoding(encoding)) {
                    throw new TypeError("Unknown encoding: " + encoding)
                }
                if (val.length === 1) {
                    var code = val.charCodeAt(0);
                    if (encoding === "utf8" && code < 128 || encoding === "latin1") {
                        val = code
                    }
                }
            } else if (typeof val === "number") {
                val = val & 255
            }
            if (start < 0 || this.length < start || this.length < end) {
                throw new RangeError("Out of range index")
            }
            if (end <= start) {
                return this
            }
            start = start >>> 0;
            end = end === undefined ? this.length : end >>> 0;
            if (!val) val = 0;
            var i;
            if (typeof val === "number") {
                for (i = start; i < end; ++i) {
                    this[i] = val
                }
            } else {
                var bytes = Buffer.isBuffer(val) ? val : new Buffer(val, encoding);
                var len = bytes.length;
                if (len === 0) {
                    throw new TypeError('The value "' + val + '" is invalid for argument "value"')
                }
                for (i = 0; i < end - start; ++i) {
                    this[i + start] = bytes[i % len]
                }
            }
            return this
        };
        var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;

        function base64clean(str) {
            str = str.split("=")[0];
            str = str.trim().replace(INVALID_BASE64_RE, "");
            if (str.length < 2) return "";
            while (str.length % 4 !== 0) {
                str = str + "="
            }
            return str
        }

        function toHex(n) {
            if (n < 16) return "0" + n.toString(16);
            return n.toString(16)
        }

        function utf8ToBytes(string, units) {
            units = units || Infinity;
            var codePoint;
            var length = string.length;
            var leadSurrogate = null;
            var bytes = [];
            for (var i = 0; i < length; ++i) {
                codePoint = string.charCodeAt(i);
                if (codePoint > 55295 && codePoint < 57344) {
                    if (!leadSurrogate) {
                        if (codePoint > 56319) {
                            if ((units -= 3) > -1) bytes.push(239, 191, 189);
                            continue
                        } else if (i + 1 === length) {
                            if ((units -= 3) > -1) bytes.push(239, 191, 189);
                            continue
                        }
                        leadSurrogate = codePoint;
                        continue
                    }
                    if (codePoint < 56320) {
                        if ((units -= 3) > -1) bytes.push(239, 191, 189);
                        leadSurrogate = codePoint;
                        continue
                    }
                    codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536
                } else if (leadSurrogate) {
                    if ((units -= 3) > -1) bytes.push(239, 191, 189)
                }
                leadSurrogate = null;
                if (codePoint < 128) {
                    if ((units -= 1) < 0) break;
                    bytes.push(codePoint)
                } else if (codePoint < 2048) {
                    if ((units -= 2) < 0) break;
                    bytes.push(codePoint >> 6 | 192, codePoint & 63 | 128)
                } else if (codePoint < 65536) {
                    if ((units -= 3) < 0) break;
                    bytes.push(codePoint >> 12 | 224, codePoint >> 6 & 63 | 128, codePoint & 63 | 128)
                } else if (codePoint < 1114112) {
                    if ((units -= 4) < 0) break;
                    bytes.push(codePoint >> 18 | 240, codePoint >> 12 & 63 | 128, codePoint >> 6 & 63 | 128, codePoint & 63 | 128)
                } else {
                    throw new Error("Invalid code point")
                }
            }
            return bytes
        }

        function asciiToBytes(str) {
            var byteArray = [];
            for (var i = 0; i < str.length; ++i) {
                byteArray.push(str.charCodeAt(i) & 255)
            }
            return byteArray
        }

        function utf16leToBytes(str, units) {
            var c, hi, lo;
            var byteArray = [];
            for (var i = 0; i < str.length; ++i) {
                if ((units -= 2) < 0) break;
                c = str.charCodeAt(i);
                hi = c >> 8;
                lo = c % 256;
                byteArray.push(lo);
                byteArray.push(hi)
            }
            return byteArray
        }

        function base64ToBytes(str) {
            return base64.toByteArray(base64clean(str))
        }

        function blitBuffer(src, dst, offset, length) {
            for (var i = 0; i < length; ++i) {
                if (i + offset >= dst.length || i >= src.length) break;
                dst[i + offset] = src[i]
            }
            return i
        }

        function isArrayBuffer(obj) {
            return obj instanceof ArrayBuffer || obj != null && obj.constructor != null && obj.constructor.name === "ArrayBuffer" && typeof obj.byteLength === "number"
        }

        function numberIsNaN(obj) {
            return obj !== obj
        }
    }, {
        "base64-js": 43,
        ieee754: 55
    }],
    47: [function (require, module, exports) {
        var slice = Array.prototype.slice;
        module.exports = co["default"] = co.co = co;
        co.wrap = function (fn) {
            createPromise.__generatorFunction__ = fn;
            return createPromise;

            function createPromise() {
                return co.call(this, fn.apply(this, arguments))
            }
        };

        function co(gen) {
            var ctx = this;
            var args = slice.call(arguments, 1);
            return new Promise(function (resolve, reject) {
                if (typeof gen === "function") gen = gen.apply(ctx, args);
                if (!gen || typeof gen.next !== "function") return resolve(gen);
                onFulfilled();

                function onFulfilled(res) {
                    var ret;
                    try {
                        ret = gen.next(res)
                    } catch (e) {
                        return reject(e)
                    }
                    next(ret)
                }

                function onRejected(err) {
                    var ret;
                    try {
                        ret = gen.throw(err)
                    } catch (e) {
                        return reject(e)
                    }
                    next(ret)
                }

                function next(ret) {
                    if (ret.done) return resolve(ret.value);
                    var value = toPromise.call(ctx, ret.value);
                    if (value && isPromise(value)) return value.then(onFulfilled, onRejected);
                    return onRejected(new TypeError("You may only yield a function, promise, generator, array, or object, " + 'but the following object was passed: "' + String(ret.value) + '"'))
                }
            })
        }

        function toPromise(obj) {
            if (!obj) return obj;
            if (isPromise(obj)) return obj;
            if (isGeneratorFunction(obj) || isGenerator(obj)) return co.call(this, obj);
            if ("function" == typeof obj) return thunkToPromise.call(this, obj);
            if (Array.isArray(obj)) return arrayToPromise.call(this, obj);
            if (isObject(obj)) return objectToPromise.call(this, obj);
            return obj
        }

        function thunkToPromise(fn) {
            var ctx = this;
            return new Promise(function (resolve, reject) {
                fn.call(ctx, function (err, res) {
                    if (err) return reject(err);
                    if (arguments.length > 2) res = slice.call(arguments, 1);
                    resolve(res)
                })
            })
        }

        function arrayToPromise(obj) {
            return Promise.all(obj.map(toPromise, this))
        }

        function objectToPromise(obj) {
            var results = new obj.constructor;
            var keys = Object.keys(obj);
            var promises = [];
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var promise = toPromise.call(this, obj[key]);
                if (promise && isPromise(promise)) defer(promise, key);
                else results[key] = obj[key]
            }
            return Promise.all(promises).then(function () {
                return results
            });

            function defer(promise, key) {
                results[key] = undefined;
                promises.push(promise.then(function (res) {
                    results[key] = res
                }))
            }
        }

        function isPromise(obj) {
            return "function" == typeof obj.then
        }

        function isGenerator(obj) {
            return "function" == typeof obj.next && "function" == typeof obj.throw
        }

        function isGeneratorFunction(obj) {
            var constructor = obj.constructor;
            if (!constructor) return false;
            if ("GeneratorFunction" === constructor.name || "GeneratorFunction" === constructor.displayName) return true;
            return isGenerator(constructor.prototype)
        }

        function isObject(val) {
            return Object == val.constructor
        }
    }, {}],
    48: [function (require, module, exports) {
        (function (root, factory) {
            if (typeof exports === "object") {
                module.exports = exports = factory()
            } else if (typeof define === "function" && define.amd) {
                define([], factory)
            } else {
                root.CryptoJS = factory()
            }
        })(this, function () {
            var CryptoJS = CryptoJS || function (Math, undefined) {
                var create = Object.create || function () {
                    function F() {}
                    return function (obj) {
                        var subtype;
                        F.prototype = obj;
                        subtype = new F;
                        F.prototype = null;
                        return subtype
                    }
                }();
                var C = {};
                var C_lib = C.lib = {};
                var Base = C_lib.Base = function () {
                    return {
                        extend: function (overrides) {
                            var subtype = create(this);
                            if (overrides) {
                                subtype.mixIn(overrides)
                            }
                            if (!subtype.hasOwnProperty("init") || this.init === subtype.init) {
                                subtype.init = function () {
                                    subtype.$super.init.apply(this, arguments)
                                }
                            }
                            subtype.init.prototype = subtype;
                            subtype.$super = this;
                            return subtype
                        },
                        create: function () {
                            var instance = this.extend();
                            instance.init.apply(instance, arguments);
                            return instance
                        },
                        init: function () {},
                        mixIn: function (properties) {
                            for (var propertyName in properties) {
                                if (properties.hasOwnProperty(propertyName)) {
                                    this[propertyName] = properties[propertyName]
                                }
                            }
                            if (properties.hasOwnProperty("toString")) {
                                this.toString = properties.toString
                            }
                        },
                        clone: function () {
                            return this.init.prototype.extend(this)
                        }
                    }
                }();
                var WordArray = C_lib.WordArray = Base.extend({
                    init: function (words, sigBytes) {
                        words = this.words = words || [];
                        if (sigBytes != undefined) {
                            this.sigBytes = sigBytes
                        } else {
                            this.sigBytes = words.length * 4
                        }
                    },
                    toString: function (encoder) {
                        return (encoder || Hex).stringify(this)
                    },
                    concat: function (wordArray) {
                        var thisWords = this.words;
                        var thatWords = wordArray.words;
                        var thisSigBytes = this.sigBytes;
                        var thatSigBytes = wordArray.sigBytes;
                        this.clamp();
                        if (thisSigBytes % 4) {
                            for (var i = 0; i < thatSigBytes; i++) {
                                var thatByte = thatWords[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                                thisWords[thisSigBytes + i >>> 2] |= thatByte << 24 - (thisSigBytes + i) % 4 * 8
                            }
                        } else {
                            for (var i = 0; i < thatSigBytes; i += 4) {
                                thisWords[thisSigBytes + i >>> 2] = thatWords[i >>> 2]
                            }
                        }
                        this.sigBytes += thatSigBytes;
                        return this
                    },
                    clamp: function () {
                        var words = this.words;
                        var sigBytes = this.sigBytes;
                        words[sigBytes >>> 2] &= 4294967295 << 32 - sigBytes % 4 * 8;
                        words.length = Math.ceil(sigBytes / 4)
                    },
                    clone: function () {
                        var clone = Base.clone.call(this);
                        clone.words = this.words.slice(0);
                        return clone
                    },
                    random: function (nBytes) {
                        var words = [];
                        var r = function (m_w) {
                            var m_w = m_w;
                            var m_z = 987654321;
                            var mask = 4294967295;
                            return function () {
                                m_z = 36969 * (m_z & 65535) + (m_z >> 16) & mask;
                                m_w = 18e3 * (m_w & 65535) + (m_w >> 16) & mask;
                                var result = (m_z << 16) + m_w & mask;
                                result /= 4294967296;
                                result += .5;
                                return result * (Math.random() > .5 ? 1 : -1)
                            }
                        };
                        for (var i = 0, rcache; i < nBytes; i += 4) {
                            var _r = r((rcache || Math.random()) * 4294967296);
                            rcache = _r() * 987654071;
                            words.push(_r() * 4294967296 | 0)
                        }
                        return new WordArray.init(words, nBytes)
                    }
                });
                var C_enc = C.enc = {};
                var Hex = C_enc.Hex = {
                    stringify: function (wordArray) {
                        var words = wordArray.words;
                        var sigBytes = wordArray.sigBytes;
                        var hexChars = [];
                        for (var i = 0; i < sigBytes; i++) {
                            var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                            hexChars.push((bite >>> 4).toString(16));
                            hexChars.push((bite & 15).toString(16))
                        }
                        return hexChars.join("")
                    },
                    parse: function (hexStr) {
                        var hexStrLength = hexStr.length;
                        var words = [];
                        for (var i = 0; i < hexStrLength; i += 2) {
                            words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << 24 - i % 8 * 4
                        }
                        return new WordArray.init(words, hexStrLength / 2)
                    }
                };
                var Latin1 = C_enc.Latin1 = {
                    stringify: function (wordArray) {
                        var words = wordArray.words;
                        var sigBytes = wordArray.sigBytes;
                        var latin1Chars = [];
                        for (var i = 0; i < sigBytes; i++) {
                            var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                            latin1Chars.push(String.fromCharCode(bite))
                        }
                        return latin1Chars.join("")
                    },
                    parse: function (latin1Str) {
                        var latin1StrLength = latin1Str.length;
                        var words = [];
                        for (var i = 0; i < latin1StrLength; i++) {
                            words[i >>> 2] |= (latin1Str.charCodeAt(i) & 255) << 24 - i % 4 * 8
                        }
                        return new WordArray.init(words, latin1StrLength)
                    }
                };
                var Utf8 = C_enc.Utf8 = {
                    stringify: function (wordArray) {
                        try {
                            return decodeURIComponent(escape(Latin1.stringify(wordArray)))
                        } catch (e) {
                            throw new Error("Malformed UTF-8 data")
                        }
                    },
                    parse: function (utf8Str) {
                        return Latin1.parse(unescape(encodeURIComponent(utf8Str)))
                    }
                };
                var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
                    reset: function () {
                        this._data = new WordArray.init;
                        this._nDataBytes = 0
                    },
                    _append: function (data) {
                        if (typeof data == "string") {
                            data = Utf8.parse(data)
                        }
                        this._data.concat(data);
                        this._nDataBytes += data.sigBytes
                    },
                    _process: function (doFlush) {
                        var data = this._data;
                        var dataWords = data.words;
                        var dataSigBytes = data.sigBytes;
                        var blockSize = this.blockSize;
                        var blockSizeBytes = blockSize * 4;
                        var nBlocksReady = dataSigBytes / blockSizeBytes;
                        if (doFlush) {
                            nBlocksReady = Math.ceil(nBlocksReady)
                        } else {
                            nBlocksReady = Math.max((nBlocksReady | 0) - this._minBufferSize, 0)
                        }
                        var nWordsReady = nBlocksReady * blockSize;
                        var nBytesReady = Math.min(nWordsReady * 4, dataSigBytes);
                        if (nWordsReady) {
                            for (var offset = 0; offset < nWordsReady; offset += blockSize) {
                                this._doProcessBlock(dataWords, offset)
                            }
                            var processedWords = dataWords.splice(0, nWordsReady);
                            data.sigBytes -= nBytesReady
                        }
                        return new WordArray.init(processedWords, nBytesReady)
                    },
                    clone: function () {
                        var clone = Base.clone.call(this);
                        clone._data = this._data.clone();
                        return clone
                    },
                    _minBufferSize: 0
                });
                var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
                    cfg: Base.extend(),
                    init: function (cfg) {
                        this.cfg = this.cfg.extend(cfg);
                        this.reset()
                    },
                    reset: function () {
                        BufferedBlockAlgorithm.reset.call(this);
                        this._doReset()
                    },
                    update: function (messageUpdate) {
                        this._append(messageUpdate);
                        this._process();
                        return this
                    },
                    finalize: function (messageUpdate) {
                        if (messageUpdate) {
                            this._append(messageUpdate)
                        }
                        var hash = this._doFinalize();
                        return hash
                    },
                    blockSize: 512 / 32,
                    _createHelper: function (hasher) {
                        return function (message, cfg) {
                            return new hasher.init(cfg).finalize(message)
                        }
                    },
                    _createHmacHelper: function (hasher) {
                        return function (message, key) {
                            return new C_algo.HMAC.init(hasher, key).finalize(message)
                        }
                    }
                });
                var C_algo = C.algo = {};
                return C
            }(Math);
            return CryptoJS
        })
    }, {}],
    49: [function (require, module, exports) {
        (function (root, factory, undef) {
            if (typeof exports === "object") {
                module.exports = exports = factory(require("./core"), require("./x64-core"))
            } else if (typeof define === "function" && define.amd) {
                define(["./core", "./x64-core"], factory)
            } else {
                factory(root.CryptoJS)
            }
        })(this, function (CryptoJS) {
            (function (Math) {
                var C = CryptoJS;
                var C_lib = C.lib;
                var WordArray = C_lib.WordArray;
                var Hasher = C_lib.Hasher;
                var C_x64 = C.x64;
                var X64Word = C_x64.Word;
                var C_algo = C.algo;
                var RHO_OFFSETS = [];
                var PI_INDEXES = [];
                var ROUND_CONSTANTS = [];
                (function () {
                    var x = 1,
                        y = 0;
                    for (var t = 0; t < 24; t++) {
                        RHO_OFFSETS[x + 5 * y] = (t + 1) * (t + 2) / 2 % 64;
                        var newX = y % 5;
                        var newY = (2 * x + 3 * y) % 5;
                        x = newX;
                        y = newY
                    }
                    for (var x = 0; x < 5; x++) {
                        for (var y = 0; y < 5; y++) {
                            PI_INDEXES[x + 5 * y] = y + (2 * x + 3 * y) % 5 * 5
                        }
                    }
                    var LFSR = 1;
                    for (var i = 0; i < 24; i++) {
                        var roundConstantMsw = 0;
                        var roundConstantLsw = 0;
                        for (var j = 0; j < 7; j++) {
                            if (LFSR & 1) {
                                var bitPosition = (1 << j) - 1;
                                if (bitPosition < 32) {
                                    roundConstantLsw ^= 1 << bitPosition
                                } else {
                                    roundConstantMsw ^= 1 << bitPosition - 32
                                }
                            }
                            if (LFSR & 128) {
                                LFSR = LFSR << 1 ^ 113
                            } else {
                                LFSR <<= 1
                            }
                        }
                        ROUND_CONSTANTS[i] = X64Word.create(roundConstantMsw, roundConstantLsw)
                    }
                })();
                var T = [];
                (function () {
                    for (var i = 0; i < 25; i++) {
                        T[i] = X64Word.create()
                    }
                })();
                var SHA3 = C_algo.SHA3 = Hasher.extend({
                    cfg: Hasher.cfg.extend({
                        outputLength: 512
                    }),
                    _doReset: function () {
                        var state = this._state = [];
                        for (var i = 0; i < 25; i++) {
                            state[i] = new X64Word.init
                        }
                        this.blockSize = (1600 - 2 * this.cfg.outputLength) / 32
                    },
                    _doProcessBlock: function (M, offset) {
                        var state = this._state;
                        var nBlockSizeLanes = this.blockSize / 2;
                        for (var i = 0; i < nBlockSizeLanes; i++) {
                            var M2i = M[offset + 2 * i];
                            var M2i1 = M[offset + 2 * i + 1];
                            M2i = (M2i << 8 | M2i >>> 24) & 16711935 | (M2i << 24 | M2i >>> 8) & 4278255360;
                            M2i1 = (M2i1 << 8 | M2i1 >>> 24) & 16711935 | (M2i1 << 24 | M2i1 >>> 8) & 4278255360;
                            var lane = state[i];
                            lane.high ^= M2i1;
                            lane.low ^= M2i
                        }
                        for (var round = 0; round < 24; round++) {
                            for (var x = 0; x < 5; x++) {
                                var tMsw = 0,
                                    tLsw = 0;
                                for (var y = 0; y < 5; y++) {
                                    var lane = state[x + 5 * y];
                                    tMsw ^= lane.high;
                                    tLsw ^= lane.low
                                }
                                var Tx = T[x];
                                Tx.high = tMsw;
                                Tx.low = tLsw
                            }
                            for (var x = 0; x < 5; x++) {
                                var Tx4 = T[(x + 4) % 5];
                                var Tx1 = T[(x + 1) % 5];
                                var Tx1Msw = Tx1.high;
                                var Tx1Lsw = Tx1.low;
                                var tMsw = Tx4.high ^ (Tx1Msw << 1 | Tx1Lsw >>> 31);
                                var tLsw = Tx4.low ^ (Tx1Lsw << 1 | Tx1Msw >>> 31);
                                for (var y = 0; y < 5; y++) {
                                    var lane = state[x + 5 * y];
                                    lane.high ^= tMsw;
                                    lane.low ^= tLsw
                                }
                            }
                            for (var laneIndex = 1; laneIndex < 25; laneIndex++) {
                                var lane = state[laneIndex];
                                var laneMsw = lane.high;
                                var laneLsw = lane.low;
                                var rhoOffset = RHO_OFFSETS[laneIndex];
                                if (rhoOffset < 32) {
                                    var tMsw = laneMsw << rhoOffset | laneLsw >>> 32 - rhoOffset;
                                    var tLsw = laneLsw << rhoOffset | laneMsw >>> 32 - rhoOffset
                                } else {
                                    var tMsw = laneLsw << rhoOffset - 32 | laneMsw >>> 64 - rhoOffset;
                                    var tLsw = laneMsw << rhoOffset - 32 | laneLsw >>> 64 - rhoOffset
                                }
                                var TPiLane = T[PI_INDEXES[laneIndex]];
                                TPiLane.high = tMsw;
                                TPiLane.low = tLsw
                            }
                            var T0 = T[0];
                            var state0 = state[0];
                            T0.high = state0.high;
                            T0.low = state0.low;
                            for (var x = 0; x < 5; x++) {
                                for (var y = 0; y < 5; y++) {
                                    var laneIndex = x + 5 * y;
                                    var lane = state[laneIndex];
                                    var TLane = T[laneIndex];
                                    var Tx1Lane = T[(x + 1) % 5 + 5 * y];
                                    var Tx2Lane = T[(x + 2) % 5 + 5 * y];
                                    lane.high = TLane.high ^ ~Tx1Lane.high & Tx2Lane.high;
                                    lane.low = TLane.low ^ ~Tx1Lane.low & Tx2Lane.low
                                }
                            }
                            var lane = state[0];
                            var roundConstant = ROUND_CONSTANTS[round];
                            lane.high ^= roundConstant.high;
                            lane.low ^= roundConstant.low
                        }
                    },
                    _doFinalize: function () {
                        var data = this._data;
                        var dataWords = data.words;
                        var nBitsTotal = this._nDataBytes * 8;
                        var nBitsLeft = data.sigBytes * 8;
                        var blockSizeBits = this.blockSize * 32;
                        dataWords[nBitsLeft >>> 5] |= 1 << 24 - nBitsLeft % 32;
                        dataWords[(Math.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits >>> 5) - 1] |= 128;
                        data.sigBytes = dataWords.length * 4;
                        this._process();
                        var state = this._state;
                        var outputLengthBytes = this.cfg.outputLength / 8;
                        var outputLengthLanes = outputLengthBytes / 8;
                        var hashWords = [];
                        for (var i = 0; i < outputLengthLanes; i++) {
                            var lane = state[i];
                            var laneMsw = lane.high;
                            var laneLsw = lane.low;
                            laneMsw = (laneMsw << 8 | laneMsw >>> 24) & 16711935 | (laneMsw << 24 | laneMsw >>> 8) & 4278255360;
                            laneLsw = (laneLsw << 8 | laneLsw >>> 24) & 16711935 | (laneLsw << 24 | laneLsw >>> 8) & 4278255360;
                            hashWords.push(laneLsw);
                            hashWords.push(laneMsw)
                        }
                        return new WordArray.init(hashWords, outputLengthBytes)
                    },
                    clone: function () {
                        var clone = Hasher.clone.call(this);
                        var state = clone._state = this._state.slice(0);
                        for (var i = 0; i < 25; i++) {
                            state[i] = state[i].clone()
                        }
                        return clone
                    }
                });
                C.SHA3 = Hasher._createHelper(SHA3);
                C.HmacSHA3 = Hasher._createHmacHelper(SHA3)
            })(Math);
            return CryptoJS.SHA3
        })
    }, {
        "./core": 48,
        "./x64-core": 50
    }],
    50: [function (require, module, exports) {
        (function (root, factory) {
            if (typeof exports === "object") {
                module.exports = exports = factory(require("./core"))
            } else if (typeof define === "function" && define.amd) {
                define(["./core"], factory)
            } else {
                factory(root.CryptoJS)
            }
        })(this, function (CryptoJS) {
            (function (undefined) {
                var C = CryptoJS;
                var C_lib = C.lib;
                var Base = C_lib.Base;
                var X32WordArray = C_lib.WordArray;
                var C_x64 = C.x64 = {};
                var X64Word = C_x64.Word = Base.extend({
                    init: function (high, low) {
                        this.high = high;
                        this.low = low
                    }
                });
                var X64WordArray = C_x64.WordArray = Base.extend({
                    init: function (words, sigBytes) {
                        words = this.words = words || [];
                        if (sigBytes != undefined) {
                            this.sigBytes = sigBytes
                        } else {
                            this.sigBytes = words.length * 8
                        }
                    },
                    toX32: function () {
                        var x64Words = this.words;
                        var x64WordsLength = x64Words.length;
                        var x32Words = [];
                        for (var i = 0; i < x64WordsLength; i++) {
                            var x64Word = x64Words[i];
                            x32Words.push(x64Word.high);
                            x32Words.push(x64Word.low)
                        }
                        return X32WordArray.create(x32Words, this.sigBytes)
                    },
                    clone: function () {
                        var clone = Base.clone.call(this);
                        var words = clone.words = this.words.slice(0);
                        var wordsLength = words.length;
                        for (var i = 0; i < wordsLength; i++) {
                            words[i] = words[i].clone()
                        }
                        return clone
                    }
                })
            })();
            return CryptoJS
        })
    }, {
        "./core": 48
    }],
    51: [function (require, module, exports) {
        (function (Buffer) {
            "use strict";
            var utils = require("./utils/index.js");
            var uint256Coder = utils.uint256Coder;
            var coderBoolean = utils.coderBoolean;
            var coderFixedBytes = utils.coderFixedBytes;
            var coderAddress = utils.coderAddress;
            var coderDynamicBytes = utils.coderDynamicBytes;
            var coderString = utils.coderString;
            var coderArray = utils.coderArray;
            var paramTypePart = utils.paramTypePart;
            var getParamCoder = utils.getParamCoder;

            function Result() {}

            function encodeParams(types, values) {
                if (types.length !== values.length) {
                    throw new Error("[ethjs-abi] while encoding params, types/values mismatch, types length " + types.length + " should be " + values.length)
                }
                var parts = [];
                types.forEach(function (type, index) {
                    var coder = getParamCoder(type);
                    parts.push({
                        dynamic: coder.dynamic,
                        value: coder.encode(values[index])
                    })
                });

                function alignSize(size) {
                    return parseInt(32 * Math.ceil(size / 32))
                }
                var staticSize = 0,
                    dynamicSize = 0;
                parts.forEach(function (part) {
                    if (part.dynamic) {
                        staticSize += 32;
                        dynamicSize += alignSize(part.value.length)
                    } else {
                        staticSize += alignSize(part.value.length)
                    }
                });
                var offset = 0,
                    dynamicOffset = staticSize;
                var data = new Buffer(staticSize + dynamicSize);
                parts.forEach(function (part, index) {
                    if (part.dynamic) {
                        uint256Coder.encode(dynamicOffset).copy(data, offset);
                        offset += 32;
                        part.value.copy(data, dynamicOffset);
                        dynamicOffset += alignSize(part.value.length)
                    } else {
                        part.value.copy(data, offset);
                        offset += alignSize(part.value.length)
                    }
                });
                return "0x" + data.toString("hex")
            }

            function decodeParams(names, types, data) {
                if (arguments.length < 3) {
                    data = types;
                    types = names;
                    names = []
                }
                data = utils.hexOrBuffer(data);
                var values = new Result;
                var offset = 0;
                types.forEach(function (type, index) {
                    var coder = getParamCoder(type);
                    if (coder.dynamic) {
                        var dynamicOffset = uint256Coder.decode(data, offset);
                        var result = coder.decode(data, dynamicOffset.value.toNumber());
                        offset += dynamicOffset.consumed
                    } else {
                        var result = coder.decode(data, offset);
                        offset += result.consumed
                    }
                    values[index] = result.value;
                    if (names[index]) {
                        values[names[index]] = result.value
                    }
                });
                return values
            }

            function encodeMethod(method, values) {
                var signature = method.name + "(" + utils.getKeys(method.inputs, "type").join(",") + ")";
                var signatureEncoded = "0x" + new Buffer(utils.keccak256(signature), "hex").slice(0, 4).toString("hex");
                var paramsEncoded = encodeParams(utils.getKeys(method.inputs, "type"), values).substring(2);
                return "" + signatureEncoded + paramsEncoded
            }

            function decodeMethod(method, data) {
                var outputNames = utils.getKeys(method.outputs, "name", true);
                var outputTypes = utils.getKeys(method.outputs, "type");
                return decodeParams(outputNames, outputTypes, utils.hexOrBuffer(data))
            }

            function encodeEvent(eventObject, values) {
                return encodeMethod(eventObject, values)
            }

            function decodeEvent(eventObject, data) {
                var inputNames = utils.getKeys(eventObject.inputs, "name", true);
                var inputTypes = utils.getKeys(eventObject.inputs, "type");
                return decodeParams(inputNames, inputTypes, utils.hexOrBuffer(data))
            }
            module.exports = {
                encodeParams: encodeParams,
                decodeParams: decodeParams,
                encodeMethod: encodeMethod,
                decodeMethod: decodeMethod,
                encodeEvent: encodeEvent,
                decodeEvent: decodeEvent
            }
        }).call(this, require("buffer").Buffer)
    }, {
        "./utils/index.js": 52,
        buffer: 46
    }],
    52: [function (require, module, exports) {
        (function (Buffer) {
            "use strict";
            var BN = require("bn.js");
            var numberToBN = require("number-to-bn");
            var keccak256 = require("js-sha3").keccak_256;

            function stripZeros(aInput) {
                var a = aInput;
                var first = a[0];
                while (a.length > 0 && first.toString() === "0") {
                    a = a.slice(1);
                    first = a[0]
                }
                return a
            }

            function bnToBuffer(bnInput) {
                var bn = bnInput;
                var hex = bn.toString(16);
                if (hex.length % 2) {
                    hex = "0" + hex
                }
                return stripZeros(new Buffer(hex, "hex"))
            }

            function isHexString(value, length) {
                if (typeof value !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/)) {
                    return false
                }
                if (length && value.length !== 2 + 2 * length) {
                    return false
                }
                return true
            }

            function hexOrBuffer(valueInput, name) {
                var value = valueInput;
                if (!Buffer.isBuffer(value)) {
                    if (!isHexString(value)) {
                        var error = new Error(name ? "[ethjs-abi] invalid " + name : "[ethjs-abi] invalid hex or buffer, must be a prefixed alphanumeric even length hex string");
                        error.reason = "[ethjs-abi] invalid hex string, hex must be prefixed and alphanumeric (e.g. 0x023..)";
                        error.value = value;
                        throw error
                    }
                    value = value.substring(2);
                    if (value.length % 2) {
                        value = "0" + value
                    }
                    value = new Buffer(value, "hex")
                }
                return value
            }

            function hexlify(value) {
                if (typeof value === "number") {
                    return "0x" + bnToBuffer(new BN(value)).toString("hex")
                } else if (value.mod || value.modulo) {
                    return "0x" + bnToBuffer(value).toString("hex")
                } else {
                    return "0x" + hexOrBuffer(value).toString("hex")
                }
            }

            function getKeys(params, key, allowEmpty) {
                var result = [];
                if (!Array.isArray(params)) {
                    throw new Error("[ethjs-abi] while getting keys, invalid params value " + JSON.stringify(params))
                }
                for (var i = 0; i < params.length; i++) {
                    var value = params[i][key];
                    if (allowEmpty && !value) {
                        value = ""
                    } else if (typeof value !== "string") {
                        throw new Error("[ethjs-abi] while getKeys found invalid ABI data structure, type value not string")
                    }
                    result.push(value)
                }
                return result
            }

            function coderNumber(size, signed) {
                return {
                    encode: function encodeNumber(valueInput) {
                        var value = valueInput;
                        if (typeof value === "object" && value.toString && (value.toTwos || value.dividedToIntegerBy)) {
                            value = value.toString(10).split(".")[0]
                        }
                        if (typeof value === "string" || typeof value === "number") {
                            value = String(value).split(".")[0]
                        }
                        value = numberToBN(value);
                        value = value.toTwos(size * 8).maskn(size * 8);
                        if (signed) {
                            value = value.fromTwos(size * 8).toTwos(256)
                        }
                        return value.toArrayLike(Buffer, "be", 32)
                    },
                    decode: function decodeNumber(data, offset) {
                        var junkLength = 32 - size;
                        var value = new BN(data.slice(offset + junkLength, offset + 32));
                        if (signed) {
                            value = value.fromTwos(size * 8)
                        } else {
                            value = value.maskn(size * 8)
                        }
                        return {
                            consumed: 32,
                            value: new BN(value.toString(10))
                        }
                    }
                }
            }
            var uint256Coder = coderNumber(32, false);
            var coderBoolean = {
                encode: function encodeBoolean(value) {
                    return uint256Coder.encode(value ? 1 : 0)
                },
                decode: function decodeBoolean(data, offset) {
                    var result = uint256Coder.decode(data, offset);
                    return {
                        consumed: result.consumed,
                        value: !result.value.isZero()
                    }
                }
            };

            function coderFixedBytes(length) {
                return {
                    encode: function encodeFixedBytes(valueInput) {
                        var value = valueInput;
                        value = hexOrBuffer(value);
                        if (value.length === 32) {
                            return value
                        }
                        var result = new Buffer(32);
                        result.fill(0);
                        value.copy(result);
                        return result
                    },
                    decode: function decodeFixedBytes(data, offset) {
                        if (data.length < offset + 32) {
                            throw new Error("[ethjs-abi] while decoding fixed bytes, invalid bytes data length: " + length)
                        }
                        return {
                            consumed: 32,
                            value: "0x" + data.slice(offset, offset + length).toString("hex")
                        }
                    }
                }
            }
            var coderAddress = {
                encode: function encodeAddress(valueInput) {
                    var value = valueInput;
                    var result = new Buffer(32);
                    if (!isHexString(value, 20)) {
                        throw new Error("[ethjs-abi] while encoding address, invalid address value, not alphanumeric 20 byte hex string")
                    }
                    value = hexOrBuffer(value);
                    result.fill(0);
                    value.copy(result, 12);
                    return result
                },
                decode: function decodeAddress(data, offset) {
                    if (data.length === 0) {
                        return {
                            consumed: 32,
                            value: "0x"
                        }
                    }
                    if (data.length < offset + 32) {
                        throw new Error("[ethjs-abi] while decoding address data, invalid address data, invalid byte length " + data.length)
                    }
                    return {
                        consumed: 32,
                        value: "0x" + data.slice(offset + 12, offset + 32).toString("hex")
                    }
                }
            };

            function encodeDynamicBytesHelper(value) {
                var dataLength = parseInt(32 * Math.ceil(value.length / 32));
                var padding = new Buffer(dataLength - value.length);
                padding.fill(0);
                return Buffer.concat([uint256Coder.encode(value.length), value, padding])
            }

            function decodeDynamicBytesHelper(data, offset) {
                if (data.length < offset + 32) {
                    throw new Error("[ethjs-abi] while decoding dynamic bytes data, invalid bytes length: " + data.length + " should be less than " + (offset + 32))
                }
                var length = uint256Coder.decode(data, offset).value;
                length = length.toNumber();
                if (data.length < offset + 32 + length) {
                    throw new Error("[ethjs-abi] while decoding dynamic bytes data, invalid bytes length: " + data.length + " should be less than " + (offset + 32 + length))
                }
                return {
                    consumed: parseInt(32 + 32 * Math.ceil(length / 32), 10),
                    value: data.slice(offset + 32, offset + 32 + length)
                }
            }
            var coderDynamicBytes = {
                encode: function encodeDynamicBytes(value) {
                    return encodeDynamicBytesHelper(hexOrBuffer(value))
                },
                decode: function decodeDynamicBytes(data, offset) {
                    var result = decodeDynamicBytesHelper(data, offset);
                    result.value = "0x" + result.value.toString("hex");
                    return result
                },
                dynamic: true
            };
            var coderString = {
                encode: function encodeString(value) {
                    return encodeDynamicBytesHelper(new Buffer(value, "utf8"))
                },
                decode: function decodeString(data, offset) {
                    var result = decodeDynamicBytesHelper(data, offset);
                    result.value = result.value.toString("utf8");
                    return result
                },
                dynamic: true
            };

            function coderArray(coder, lengthInput) {
                return {
                    encode: function encodeArray(value) {
                        var result = new Buffer(0);
                        var length = lengthInput;
                        if (!Array.isArray(value)) {
                            throw new Error("[ethjs-abi] while encoding array, invalid array data, not type Object (Array)")
                        }
                        if (length === -1) {
                            length = value.length;
                            result = uint256Coder.encode(length)
                        }
                        if (length !== value.length) {
                            throw new Error("[ethjs-abi] while encoding array, size mismatch array length " + length + " does not equal " + value.length)
                        }
                        value.forEach(function (resultValue) {
                            result = Buffer.concat([result, coder.encode(resultValue)])
                        });
                        return result
                    },
                    decode: function decodeArray(data, offsetInput) {
                        var length = lengthInput;
                        var offset = offsetInput;
                        var consumed = 0;
                        var decodeResult;
                        if (length === -1) {
                            decodeResult = uint256Coder.decode(data, offset);
                            length = decodeResult.value.toNumber();
                            consumed += decodeResult.consumed;
                            offset += decodeResult.consumed
                        }
                        var value = [];
                        for (var i = 0; i < length; i++) {
                            var loopResult = coder.decode(data, offset);
                            consumed += loopResult.consumed;
                            offset += loopResult.consumed;
                            value.push(loopResult.value)
                        }
                        return {
                            consumed: consumed,
                            value: value
                        }
                    },
                    dynamic: lengthInput === -1
                }
            }
            var paramTypePart = new RegExp(/^((u?int|bytes)([0-9]*)|(address|bool|string)|(\[([0-9]*)\]))/);

            function getParamCoder(typeInput) {
                var type = typeInput;
                var coder = null;
                var invalidTypeErrorMessage = "[ethjs-abi] while getting param coder (getParamCoder) type value " + JSON.stringify(type) + " is either invalid or unsupported by ethjs-abi.";
                while (type) {
                    var part = type.match(paramTypePart);
                    if (!part) {
                        throw new Error(invalidTypeErrorMessage)
                    }
                    type = type.substring(part[0].length);
                    var prefix = part[2] || part[4] || part[5];
                    switch (prefix) {
                        case "int":
                        case "uint":
                            if (coder) {
                                throw new Error(invalidTypeErrorMessage)
                            }
                            var intSize = parseInt(part[3] || 256);
                            if (intSize === 0 || intSize > 256 || intSize % 8 !== 0) {
                                throw new Error("[ethjs-abi] while getting param coder for type " + type + ", invalid " + prefix + "<N> width: " + type)
                            }
                            coder = coderNumber(intSize / 8, prefix === "int");
                            break;
                        case "bool":
                            if (coder) {
                                throw new Error(invalidTypeErrorMessage)
                            }
                            coder = coderBoolean;
                            break;
                        case "string":
                            if (coder) {
                                throw new Error(invalidTypeErrorMessage)
                            }
                            coder = coderString;
                            break;
                        case "bytes":
                            if (coder) {
                                throw new Error(invalidTypeErrorMessage)
                            }
                            if (part[3]) {
                                var size = parseInt(part[3]);
                                if (size === 0 || size > 32) {
                                    throw new Error("[ethjs-abi] while getting param coder for prefix bytes, invalid type " + type + ", size " + size + " should be 0 or greater than 32")
                                }
                                coder = coderFixedBytes(size)
                            } else {
                                coder = coderDynamicBytes
                            }
                            break;
                        case "address":
                            if (coder) {
                                throw new Error(invalidTypeErrorMessage)
                            }
                            coder = coderAddress;
                            break;
                        case "[]":
                            if (!coder || coder.dynamic) {
                                throw new Error(invalidTypeErrorMessage)
                            }
                            coder = coderArray(coder, -1);
                            break;
                        default:
                            if (!coder || coder.dynamic) {
                                throw new Error(invalidTypeErrorMessage)
                            }
                            var defaultSize = parseInt(part[6]);
                            coder = coderArray(coder, defaultSize)
                    }
                }
                if (!coder) {
                    throw new Error(invalidTypeErrorMessage)
                }
                return coder
            }
            module.exports = {
                BN: BN,
                bnToBuffer: bnToBuffer,
                isHexString: isHexString,
                hexOrBuffer: hexOrBuffer,
                hexlify: hexlify,
                stripZeros: stripZeros,
                keccak256: keccak256,
                getKeys: getKeys,
                numberToBN: numberToBN,
                coderNumber: coderNumber,
                uint256Coder: uint256Coder,
                coderBoolean: coderBoolean,
                coderFixedBytes: coderFixedBytes,
                coderAddress: coderAddress,
                coderDynamicBytes: coderDynamicBytes,
                coderString: coderString,
                coderArray: coderArray,
                paramTypePart: paramTypePart,
                getParamCoder: getParamCoder
            }
        }).call(this, require("buffer").Buffer)
    }, {
        "bn.js": 44,
        buffer: 46,
        "js-sha3": 57,
        "number-to-bn": 59
    }],
    53: [function (require, module, exports) {
        "use strict";
        var isArray = Array.isArray;
        var keyList = Object.keys;
        var hasProp = Object.prototype.hasOwnProperty;
        module.exports = function equal(a, b) {
            if (a === b) return true;
            var arrA = isArray(a),
                arrB = isArray(b),
                i, length, key;
            if (arrA && arrB) {
                length = a.length;
                if (length != b.length) return false;
                for (i = 0; i < length; i++)
                    if (!equal(a[i], b[i])) return false;
                return true
            }
            if (arrA != arrB) return false;
            var dateA = a instanceof Date,
                dateB = b instanceof Date;
            if (dateA != dateB) return false;
            if (dateA && dateB) return a.getTime() == b.getTime();
            var regexpA = a instanceof RegExp,
                regexpB = b instanceof RegExp;
            if (regexpA != regexpB) return false;
            if (regexpA && regexpB) return a.toString() == b.toString();
            if (a instanceof Object && b instanceof Object) {
                var keys = keyList(a);
                length = keys.length;
                if (length !== keyList(b).length) return false;
                for (i = 0; i < length; i++)
                    if (!hasProp.call(b, keys[i])) return false;
                for (i = 0; i < length; i++) {
                    key = keys[i];
                    if (!equal(a[key], b[key])) return false
                }
                return true
            }
            return false
        }
    }, {}],
    54: [function (require, module, exports) {
        "use strict";
        module.exports = function (data, opts) {
            if (!opts) opts = {};
            if (typeof opts === "function") opts = {
                cmp: opts
            };
            var cycles = typeof opts.cycles === "boolean" ? opts.cycles : false;
            var cmp = opts.cmp && function (f) {
                return function (node) {
                    return function (a, b) {
                        var aobj = {
                            key: a,
                            value: node[a]
                        };
                        var bobj = {
                            key: b,
                            value: node[b]
                        };
                        return f(aobj, bobj)
                    }
                }
            }(opts.cmp);
            var seen = [];
            return function stringify(node) {
                if (node && node.toJSON && typeof node.toJSON === "function") {
                    node = node.toJSON()
                }
                if (node === undefined) return;
                if (typeof node == "number") return isFinite(node) ? "" + node : "null";
                if (typeof node !== "object") return JSON.stringify(node);
                var i, out;
                if (Array.isArray(node)) {
                    out = "[";
                    for (i = 0; i < node.length; i++) {
                        if (i) out += ",";
                        out += stringify(node[i]) || "null"
                    }
                    return out + "]"
                }
                if (node === null) return "null";
                if (seen.indexOf(node) !== -1) {
                    if (cycles) return JSON.stringify("__cycle__");
                    throw new TypeError("Converting circular structure to JSON")
                }
                var seenIndex = seen.push(node) - 1;
                var keys = Object.keys(node).sort(cmp && cmp(node));
                out = "";
                for (i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    var value = stringify(node[key]);
                    if (!value) continue;
                    if (out) out += ",";
                    out += JSON.stringify(key) + ":" + value
                }
                seen.splice(seenIndex, 1);
                return "{" + out + "}"
            }(data)
        }
    }, {}],
    55: [function (require, module, exports) {
        exports.read = function (buffer, offset, isLE, mLen, nBytes) {
            var e, m;
            var eLen = nBytes * 8 - mLen - 1;
            var eMax = (1 << eLen) - 1;
            var eBias = eMax >> 1;
            var nBits = -7;
            var i = isLE ? nBytes - 1 : 0;
            var d = isLE ? -1 : 1;
            var s = buffer[offset + i];
            i += d;
            e = s & (1 << -nBits) - 1;
            s >>= -nBits;
            nBits += eLen;
            for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}
            m = e & (1 << -nBits) - 1;
            e >>= -nBits;
            nBits += mLen;
            for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}
            if (e === 0) {
                e = 1 - eBias
            } else if (e === eMax) {
                return m ? NaN : (s ? -1 : 1) * Infinity
            } else {
                m = m + Math.pow(2, mLen);
                e = e - eBias
            }
            return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
        };
        exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
            var e, m, c;
            var eLen = nBytes * 8 - mLen - 1;
            var eMax = (1 << eLen) - 1;
            var eBias = eMax >> 1;
            var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
            var i = isLE ? 0 : nBytes - 1;
            var d = isLE ? 1 : -1;
            var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
            value = Math.abs(value);
            if (isNaN(value) || value === Infinity) {
                m = isNaN(value) ? 1 : 0;
                e = eMax
            } else {
                e = Math.floor(Math.log(value) / Math.LN2);
                if (value * (c = Math.pow(2, -e)) < 1) {
                    e--;
                    c *= 2
                }
                if (e + eBias >= 1) {
                    value += rt / c
                } else {
                    value += rt * Math.pow(2, 1 - eBias)
                }
                if (value * c >= 2) {
                    e++;
                    c /= 2
                }
                if (e + eBias >= eMax) {
                    m = 0;
                    e = eMax
                } else if (e + eBias >= 1) {
                    m = (value * c - 1) * Math.pow(2, mLen);
                    e = e + eBias
                } else {
                    m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
                    e = 0
                }
            }
            for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {}
            e = e << mLen | m;
            eLen += mLen;
            for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {}
            buffer[offset + i - d] |= s * 128
        }
    }, {}],
    56: [function (require, module, exports) {
        module.exports = function isHexPrefixed(str) {
            if (typeof str !== "string") {
                throw new Error("[is-hex-prefixed] value must be type 'string', is currently type " + typeof str + ", while checking isHexPrefixed.")
            }
            return str.slice(0, 2) === "0x"
        }
    }, {}],
    57: [function (require, module, exports) {
        (function (process, global) {
            (function (root) {
                "use strict";
                var NODE_JS = typeof process == "object" && process.versions && process.versions.node;
                if (NODE_JS) {
                    root = global
                }
                var COMMON_JS = !root.JS_SHA3_TEST && typeof module == "object" && module.exports;
                var HEX_CHARS = "0123456789abcdef".split("");
                var SHAKE_PADDING = [31, 7936, 2031616, 520093696];
                var KECCAK_PADDING = [1, 256, 65536, 16777216];
                var PADDING = [6, 1536, 393216, 100663296];
                var SHIFT = [0, 8, 16, 24];
                var RC = [1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648, 32907, 0, 2147483649, 0, 2147516545, 2147483648, 32777, 2147483648, 138, 0, 136, 0, 2147516425, 0, 2147483658, 0, 2147516555, 0, 139, 2147483648, 32905, 2147483648, 32771, 2147483648, 32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648, 2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648];
                var BITS = [224, 256, 384, 512];
                var SHAKE_BITS = [128, 256];
                var OUTPUT_TYPES = ["hex", "buffer", "arrayBuffer", "array"];
                var createOutputMethod = function (bits, padding, outputType) {
                    return function (message) {
                        return new Keccak(bits, padding, bits).update(message)[outputType]()
                    }
                };
                var createShakeOutputMethod = function (bits, padding, outputType) {
                    return function (message, outputBits) {
                        return new Keccak(bits, padding, outputBits).update(message)[outputType]()
                    }
                };
                var createMethod = function (bits, padding) {
                    var method = createOutputMethod(bits, padding, "hex");
                    method.create = function () {
                        return new Keccak(bits, padding, bits)
                    };
                    method.update = function (message) {
                        return method.create().update(message)
                    };
                    for (var i = 0; i < OUTPUT_TYPES.length; ++i) {
                        var type = OUTPUT_TYPES[i];
                        method[type] = createOutputMethod(bits, padding, type)
                    }
                    return method
                };
                var createShakeMethod = function (bits, padding) {
                    var method = createShakeOutputMethod(bits, padding, "hex");
                    method.create = function (outputBits) {
                        return new Keccak(bits, padding, outputBits)
                    };
                    method.update = function (message, outputBits) {
                        return method.create(outputBits).update(message)
                    };
                    for (var i = 0; i < OUTPUT_TYPES.length; ++i) {
                        var type = OUTPUT_TYPES[i];
                        method[type] = createShakeOutputMethod(bits, padding, type)
                    }
                    return method
                };
                var algorithms = [{
                    name: "keccak",
                    padding: KECCAK_PADDING,
                    bits: BITS,
                    createMethod: createMethod
                }, {
                    name: "sha3",
                    padding: PADDING,
                    bits: BITS,
                    createMethod: createMethod
                }, {
                    name: "shake",
                    padding: SHAKE_PADDING,
                    bits: SHAKE_BITS,
                    createMethod: createShakeMethod
                }];
                var methods = {};
                for (var i = 0; i < algorithms.length; ++i) {
                    var algorithm = algorithms[i];
                    var bits = algorithm.bits;
                    for (var j = 0; j < bits.length; ++j) {
                        methods[algorithm.name + "_" + bits[j]] = algorithm.createMethod(bits[j], algorithm.padding)
                    }
                }

                function Keccak(bits, padding, outputBits) {
                    this.blocks = [];
                    this.s = [];
                    this.padding = padding;
                    this.outputBits = outputBits;
                    this.reset = true;
                    this.block = 0;
                    this.start = 0;
                    this.blockCount = 1600 - (bits << 1) >> 5;
                    this.byteCount = this.blockCount << 2;
                    this.outputBlocks = outputBits >> 5;
                    this.extraBytes = (outputBits & 31) >> 3;
                    for (var i = 0; i < 50; ++i) {
                        this.s[i] = 0
                    }
                }
                Keccak.prototype.update = function (message) {
                    var notString = typeof message != "string";
                    if (notString && message.constructor == root.ArrayBuffer) {
                        message = new Uint8Array(message)
                    }
                    var length = message.length,
                        blocks = this.blocks,
                        byteCount = this.byteCount,
                        blockCount = this.blockCount,
                        index = 0,
                        s = this.s,
                        i, code;
                    while (index < length) {
                        if (this.reset) {
                            this.reset = false;
                            blocks[0] = this.block;
                            for (i = 1; i < blockCount + 1; ++i) {
                                blocks[i] = 0
                            }
                        }
                        if (notString) {
                            for (i = this.start; index < length && i < byteCount; ++index) {
                                blocks[i >> 2] |= message[index] << SHIFT[i++ & 3]
                            }
                        } else {
                            for (i = this.start; index < length && i < byteCount; ++index) {
                                code = message.charCodeAt(index);
                                if (code < 128) {
                                    blocks[i >> 2] |= code << SHIFT[i++ & 3]
                                } else if (code < 2048) {
                                    blocks[i >> 2] |= (192 | code >> 6) << SHIFT[i++ & 3];
                                    blocks[i >> 2] |= (128 | code & 63) << SHIFT[i++ & 3]
                                } else if (code < 55296 || code >= 57344) {
                                    blocks[i >> 2] |= (224 | code >> 12) << SHIFT[i++ & 3];
                                    blocks[i >> 2] |= (128 | code >> 6 & 63) << SHIFT[i++ & 3];
                                    blocks[i >> 2] |= (128 | code & 63) << SHIFT[i++ & 3]
                                } else {
                                    code = 65536 + ((code & 1023) << 10 | message.charCodeAt(++index) & 1023);
                                    blocks[i >> 2] |= (240 | code >> 18) << SHIFT[i++ & 3];
                                    blocks[i >> 2] |= (128 | code >> 12 & 63) << SHIFT[i++ & 3];
                                    blocks[i >> 2] |= (128 | code >> 6 & 63) << SHIFT[i++ & 3];
                                    blocks[i >> 2] |= (128 | code & 63) << SHIFT[i++ & 3]
                                }
                            }
                        }
                        this.lastByteIndex = i;
                        if (i >= byteCount) {
                            this.start = i - byteCount;
                            this.block = blocks[blockCount];
                            for (i = 0; i < blockCount; ++i) {
                                s[i] ^= blocks[i]
                            }
                            f(s);
                            this.reset = true
                        } else {
                            this.start = i
                        }
                    }
                    return this
                };
                Keccak.prototype.finalize = function () {
                    var blocks = this.blocks,
                        i = this.lastByteIndex,
                        blockCount = this.blockCount,
                        s = this.s;
                    blocks[i >> 2] |= this.padding[i & 3];
                    if (this.lastByteIndex == this.byteCount) {
                        blocks[0] = blocks[blockCount];
                        for (i = 1; i < blockCount + 1; ++i) {
                            blocks[i] = 0
                        }
                    }
                    blocks[blockCount - 1] |= 2147483648;
                    for (i = 0; i < blockCount; ++i) {
                        s[i] ^= blocks[i]
                    }
                    f(s)
                };
                Keccak.prototype.toString = Keccak.prototype.hex = function () {
                    this.finalize();
                    var blockCount = this.blockCount,
                        s = this.s,
                        outputBlocks = this.outputBlocks,
                        extraBytes = this.extraBytes,
                        i = 0,
                        j = 0;
                    var hex = "",
                        block;
                    while (j < outputBlocks) {
                        for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                            block = s[i];
                            hex += HEX_CHARS[block >> 4 & 15] + HEX_CHARS[block & 15] + HEX_CHARS[block >> 12 & 15] + HEX_CHARS[block >> 8 & 15] + HEX_CHARS[block >> 20 & 15] + HEX_CHARS[block >> 16 & 15] + HEX_CHARS[block >> 28 & 15] + HEX_CHARS[block >> 24 & 15]
                        }
                        if (j % blockCount == 0) {
                            f(s);
                            i = 0
                        }
                    }
                    if (extraBytes) {
                        block = s[i];
                        if (extraBytes > 0) {
                            hex += HEX_CHARS[block >> 4 & 15] + HEX_CHARS[block & 15]
                        }
                        if (extraBytes > 1) {
                            hex += HEX_CHARS[block >> 12 & 15] + HEX_CHARS[block >> 8 & 15]
                        }
                        if (extraBytes > 2) {
                            hex += HEX_CHARS[block >> 20 & 15] + HEX_CHARS[block >> 16 & 15]
                        }
                    }
                    return hex
                };
                Keccak.prototype.arrayBuffer = function () {
                    this.finalize();
                    var blockCount = this.blockCount,
                        s = this.s,
                        outputBlocks = this.outputBlocks,
                        extraBytes = this.extraBytes,
                        i = 0,
                        j = 0;
                    var bytes = this.outputBits >> 3;
                    var buffer;
                    if (extraBytes) {
                        buffer = new ArrayBuffer(outputBlocks + 1 << 2)
                    } else {
                        buffer = new ArrayBuffer(bytes)
                    }
                    var array = new Uint32Array(buffer);
                    while (j < outputBlocks) {
                        for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                            array[j] = s[i]
                        }
                        if (j % blockCount == 0) {
                            f(s)
                        }
                    }
                    if (extraBytes) {
                        array[i] = s[i];
                        buffer = buffer.slice(0, bytes)
                    }
                    return buffer
                };
                Keccak.prototype.buffer = Keccak.prototype.arrayBuffer;
                Keccak.prototype.digest = Keccak.prototype.array = function () {
                    this.finalize();
                    var blockCount = this.blockCount,
                        s = this.s,
                        outputBlocks = this.outputBlocks,
                        extraBytes = this.extraBytes,
                        i = 0,
                        j = 0;
                    var array = [],
                        offset, block;
                    while (j < outputBlocks) {
                        for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                            offset = j << 2;
                            block = s[i];
                            array[offset] = block & 255;
                            array[offset + 1] = block >> 8 & 255;
                            array[offset + 2] = block >> 16 & 255;
                            array[offset + 3] = block >> 24 & 255
                        }
                        if (j % blockCount == 0) {
                            f(s)
                        }
                    }
                    if (extraBytes) {
                        offset = j << 2;
                        block = s[i];
                        if (extraBytes > 0) {
                            array[offset] = block & 255
                        }
                        if (extraBytes > 1) {
                            array[offset + 1] = block >> 8 & 255
                        }
                        if (extraBytes > 2) {
                            array[offset + 2] = block >> 16 & 255
                        }
                    }
                    return array
                };
                var f = function (s) {
                    var h, l, n, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15, b16, b17, b18, b19, b20, b21, b22, b23, b24, b25, b26, b27, b28, b29, b30, b31, b32, b33, b34, b35, b36, b37, b38, b39, b40, b41, b42, b43, b44, b45, b46, b47, b48, b49;
                    for (n = 0; n < 48; n += 2) {
                        c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40];
                        c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
                        c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42];
                        c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
                        c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44];
                        c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
                        c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46];
                        c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
                        c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48];
                        c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];
                        h = c8 ^ (c2 << 1 | c3 >>> 31);
                        l = c9 ^ (c3 << 1 | c2 >>> 31);
                        s[0] ^= h;
                        s[1] ^= l;
                        s[10] ^= h;
                        s[11] ^= l;
                        s[20] ^= h;
                        s[21] ^= l;
                        s[30] ^= h;
                        s[31] ^= l;
                        s[40] ^= h;
                        s[41] ^= l;
                        h = c0 ^ (c4 << 1 | c5 >>> 31);
                        l = c1 ^ (c5 << 1 | c4 >>> 31);
                        s[2] ^= h;
                        s[3] ^= l;
                        s[12] ^= h;
                        s[13] ^= l;
                        s[22] ^= h;
                        s[23] ^= l;
                        s[32] ^= h;
                        s[33] ^= l;
                        s[42] ^= h;
                        s[43] ^= l;
                        h = c2 ^ (c6 << 1 | c7 >>> 31);
                        l = c3 ^ (c7 << 1 | c6 >>> 31);
                        s[4] ^= h;
                        s[5] ^= l;
                        s[14] ^= h;
                        s[15] ^= l;
                        s[24] ^= h;
                        s[25] ^= l;
                        s[34] ^= h;
                        s[35] ^= l;
                        s[44] ^= h;
                        s[45] ^= l;
                        h = c4 ^ (c8 << 1 | c9 >>> 31);
                        l = c5 ^ (c9 << 1 | c8 >>> 31);
                        s[6] ^= h;
                        s[7] ^= l;
                        s[16] ^= h;
                        s[17] ^= l;
                        s[26] ^= h;
                        s[27] ^= l;
                        s[36] ^= h;
                        s[37] ^= l;
                        s[46] ^= h;
                        s[47] ^= l;
                        h = c6 ^ (c0 << 1 | c1 >>> 31);
                        l = c7 ^ (c1 << 1 | c0 >>> 31);
                        s[8] ^= h;
                        s[9] ^= l;
                        s[18] ^= h;
                        s[19] ^= l;
                        s[28] ^= h;
                        s[29] ^= l;
                        s[38] ^= h;
                        s[39] ^= l;
                        s[48] ^= h;
                        s[49] ^= l;
                        b0 = s[0];
                        b1 = s[1];
                        b32 = s[11] << 4 | s[10] >>> 28;
                        b33 = s[10] << 4 | s[11] >>> 28;
                        b14 = s[20] << 3 | s[21] >>> 29;
                        b15 = s[21] << 3 | s[20] >>> 29;
                        b46 = s[31] << 9 | s[30] >>> 23;
                        b47 = s[30] << 9 | s[31] >>> 23;
                        b28 = s[40] << 18 | s[41] >>> 14;
                        b29 = s[41] << 18 | s[40] >>> 14;
                        b20 = s[2] << 1 | s[3] >>> 31;
                        b21 = s[3] << 1 | s[2] >>> 31;
                        b2 = s[13] << 12 | s[12] >>> 20;
                        b3 = s[12] << 12 | s[13] >>> 20;
                        b34 = s[22] << 10 | s[23] >>> 22;
                        b35 = s[23] << 10 | s[22] >>> 22;
                        b16 = s[33] << 13 | s[32] >>> 19;
                        b17 = s[32] << 13 | s[33] >>> 19;
                        b48 = s[42] << 2 | s[43] >>> 30;
                        b49 = s[43] << 2 | s[42] >>> 30;
                        b40 = s[5] << 30 | s[4] >>> 2;
                        b41 = s[4] << 30 | s[5] >>> 2;
                        b22 = s[14] << 6 | s[15] >>> 26;
                        b23 = s[15] << 6 | s[14] >>> 26;
                        b4 = s[25] << 11 | s[24] >>> 21;
                        b5 = s[24] << 11 | s[25] >>> 21;
                        b36 = s[34] << 15 | s[35] >>> 17;
                        b37 = s[35] << 15 | s[34] >>> 17;
                        b18 = s[45] << 29 | s[44] >>> 3;
                        b19 = s[44] << 29 | s[45] >>> 3;
                        b10 = s[6] << 28 | s[7] >>> 4;
                        b11 = s[7] << 28 | s[6] >>> 4;
                        b42 = s[17] << 23 | s[16] >>> 9;
                        b43 = s[16] << 23 | s[17] >>> 9;
                        b24 = s[26] << 25 | s[27] >>> 7;
                        b25 = s[27] << 25 | s[26] >>> 7;
                        b6 = s[36] << 21 | s[37] >>> 11;
                        b7 = s[37] << 21 | s[36] >>> 11;
                        b38 = s[47] << 24 | s[46] >>> 8;
                        b39 = s[46] << 24 | s[47] >>> 8;
                        b30 = s[8] << 27 | s[9] >>> 5;
                        b31 = s[9] << 27 | s[8] >>> 5;
                        b12 = s[18] << 20 | s[19] >>> 12;
                        b13 = s[19] << 20 | s[18] >>> 12;
                        b44 = s[29] << 7 | s[28] >>> 25;
                        b45 = s[28] << 7 | s[29] >>> 25;
                        b26 = s[38] << 8 | s[39] >>> 24;
                        b27 = s[39] << 8 | s[38] >>> 24;
                        b8 = s[48] << 14 | s[49] >>> 18;
                        b9 = s[49] << 14 | s[48] >>> 18;
                        s[0] = b0 ^ ~b2 & b4;
                        s[1] = b1 ^ ~b3 & b5;
                        s[10] = b10 ^ ~b12 & b14;
                        s[11] = b11 ^ ~b13 & b15;
                        s[20] = b20 ^ ~b22 & b24;
                        s[21] = b21 ^ ~b23 & b25;
                        s[30] = b30 ^ ~b32 & b34;
                        s[31] = b31 ^ ~b33 & b35;
                        s[40] = b40 ^ ~b42 & b44;
                        s[41] = b41 ^ ~b43 & b45;
                        s[2] = b2 ^ ~b4 & b6;
                        s[3] = b3 ^ ~b5 & b7;
                        s[12] = b12 ^ ~b14 & b16;
                        s[13] = b13 ^ ~b15 & b17;
                        s[22] = b22 ^ ~b24 & b26;
                        s[23] = b23 ^ ~b25 & b27;
                        s[32] = b32 ^ ~b34 & b36;
                        s[33] = b33 ^ ~b35 & b37;
                        s[42] = b42 ^ ~b44 & b46;
                        s[43] = b43 ^ ~b45 & b47;
                        s[4] = b4 ^ ~b6 & b8;
                        s[5] = b5 ^ ~b7 & b9;
                        s[14] = b14 ^ ~b16 & b18;
                        s[15] = b15 ^ ~b17 & b19;
                        s[24] = b24 ^ ~b26 & b28;
                        s[25] = b25 ^ ~b27 & b29;
                        s[34] = b34 ^ ~b36 & b38;
                        s[35] = b35 ^ ~b37 & b39;
                        s[44] = b44 ^ ~b46 & b48;
                        s[45] = b45 ^ ~b47 & b49;
                        s[6] = b6 ^ ~b8 & b0;
                        s[7] = b7 ^ ~b9 & b1;
                        s[16] = b16 ^ ~b18 & b10;
                        s[17] = b17 ^ ~b19 & b11;
                        s[26] = b26 ^ ~b28 & b20;
                        s[27] = b27 ^ ~b29 & b21;
                        s[36] = b36 ^ ~b38 & b30;
                        s[37] = b37 ^ ~b39 & b31;
                        s[46] = b46 ^ ~b48 & b40;
                        s[47] = b47 ^ ~b49 & b41;
                        s[8] = b8 ^ ~b0 & b2;
                        s[9] = b9 ^ ~b1 & b3;
                        s[18] = b18 ^ ~b10 & b12;
                        s[19] = b19 ^ ~b11 & b13;
                        s[28] = b28 ^ ~b20 & b22;
                        s[29] = b29 ^ ~b21 & b23;
                        s[38] = b38 ^ ~b30 & b32;
                        s[39] = b39 ^ ~b31 & b33;
                        s[48] = b48 ^ ~b40 & b42;
                        s[49] = b49 ^ ~b41 & b43;
                        s[0] ^= RC[n];
                        s[1] ^= RC[n + 1]
                    }
                };
                if (COMMON_JS) {
                    module.exports = methods
                } else if (root) {
                    for (var key in methods) {
                        root[key] = methods[key]
                    }
                }
            })(this)
        }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
    }, {
        _process: 60
    }],
    58: [function (require, module, exports) {
        "use strict";
        var traverse = module.exports = function (schema, opts, cb) {
            if (typeof opts == "function") {
                cb = opts;
                opts = {}
            }
            _traverse(opts, cb, schema, "", schema)
        };
        traverse.keywords = {
            additionalItems: true,
            items: true,
            contains: true,
            additionalProperties: true,
            propertyNames: true,
            not: true
        };
        traverse.arrayKeywords = {
            items: true,
            allOf: true,
            anyOf: true,
            oneOf: true
        };
        traverse.propsKeywords = {
            definitions: true,
            properties: true,
            patternProperties: true,
            dependencies: true
        };
        traverse.skipKeywords = {
            enum: true,
            const: true,
            required: true,
            maximum: true,
            minimum: true,
            exclusiveMaximum: true,
            exclusiveMinimum: true,
            multipleOf: true,
            maxLength: true,
            minLength: true,
            pattern: true,
            format: true,
            maxItems: true,
            minItems: true,
            uniqueItems: true,
            maxProperties: true,
            minProperties: true
        };

        function _traverse(opts, cb, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
            if (schema && typeof schema == "object" && !Array.isArray(schema)) {
                cb(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
                for (var key in schema) {
                    var sch = schema[key];
                    if (Array.isArray(sch)) {
                        if (key in traverse.arrayKeywords) {
                            for (var i = 0; i < sch.length; i++) _traverse(opts, cb, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i)
                        }
                    } else if (key in traverse.propsKeywords) {
                        if (sch && typeof sch == "object") {
                            for (var prop in sch) _traverse(opts, cb, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop)
                        }
                    } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
                        _traverse(opts, cb, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema)
                    }
                }
            }
        }

        function escapeJsonPtr(str) {
            return str.replace(/~/g, "~0").replace(/\//g, "~1")
        }
    }, {}],
    59: [function (require, module, exports) {
        var BN = require("bn.js");
        var stripHexPrefix = require("strip-hex-prefix");
        module.exports = function numberToBN(arg) {
            if (typeof arg === "string" || typeof arg === "number") {
                var multiplier = new BN(1);
                var formattedString = String(arg).toLowerCase().trim();
                var isHexPrefixed = formattedString.substr(0, 2) === "0x" || formattedString.substr(0, 3) === "-0x";
                var stringArg = stripHexPrefix(formattedString);
                if (stringArg.substr(0, 1) === "-") {
                    stringArg = stripHexPrefix(stringArg.slice(1));
                    multiplier = new BN(-1, 10)
                }
                stringArg = stringArg === "" ? "0" : stringArg;
                if (!stringArg.match(/^-?[0-9]+$/) && stringArg.match(/^[0-9A-Fa-f]+$/) || stringArg.match(/^[a-fA-F]+$/) || isHexPrefixed === true && stringArg.match(/^[0-9A-Fa-f]+$/)) {
                    return new BN(stringArg, 16).mul(multiplier)
                }
                if ((stringArg.match(/^-?[0-9]+$/) || stringArg === "") && isHexPrefixed === false) {
                    return new BN(stringArg, 10).mul(multiplier)
                }
            } else if (typeof arg === "object" && arg.toString && (!arg.pop && !arg.push)) {
                if (arg.toString(10).match(/^-?[0-9]+$/) && (arg.mul || arg.dividedToIntegerBy)) {
                    return new BN(arg.toString(10), 10)
                }
            }
            throw new Error("[number-to-bn] while converting number " + JSON.stringify(arg) + " to BN.js instance, error: invalid number value. Value must be an integer, hex string, BN or BigNumber instance. Note, decimals are not supported.")
        }
    }, {
        "bn.js": 44,
        "strip-hex-prefix": 65
    }],
    60: [function (require, module, exports) {
        var process = module.exports = {};
        var cachedSetTimeout;
        var cachedClearTimeout;

        function defaultSetTimout() {
            throw new Error("setTimeout has not been defined")
        }

        function defaultClearTimeout() {
            throw new Error("clearTimeout has not been defined")
        }(function () {
            try {
                if (typeof setTimeout === "function") {
                    cachedSetTimeout = setTimeout
                } else {
                    cachedSetTimeout = defaultSetTimout
                }
            } catch (e) {
                cachedSetTimeout = defaultSetTimout
            }
            try {
                if (typeof clearTimeout === "function") {
                    cachedClearTimeout = clearTimeout
                } else {
                    cachedClearTimeout = defaultClearTimeout
                }
            } catch (e) {
                cachedClearTimeout = defaultClearTimeout
            }
        })();

        function runTimeout(fun) {
            if (cachedSetTimeout === setTimeout) {
                return setTimeout(fun, 0)
            }
            if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
                cachedSetTimeout = setTimeout;
                return setTimeout(fun, 0)
            }
            try {
                return cachedSetTimeout(fun, 0)
            } catch (e) {
                try {
                    return cachedSetTimeout.call(null, fun, 0)
                } catch (e) {
                    return cachedSetTimeout.call(this, fun, 0)
                }
            }
        }

        function runClearTimeout(marker) {
            if (cachedClearTimeout === clearTimeout) {
                return clearTimeout(marker)
            }
            if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
                cachedClearTimeout = clearTimeout;
                return clearTimeout(marker)
            }
            try {
                return cachedClearTimeout(marker)
            } catch (e) {
                try {
                    return cachedClearTimeout.call(null, marker)
                } catch (e) {
                    return cachedClearTimeout.call(this, marker)
                }
            }
        }
        var queue = [];
        var draining = false;
        var currentQueue;
        var queueIndex = -1;

        function cleanUpNextTick() {
            if (!draining || !currentQueue) {
                return
            }
            draining = false;
            if (currentQueue.length) {
                queue = currentQueue.concat(queue)
            } else {
                queueIndex = -1
            }
            if (queue.length) {
                drainQueue()
            }
        }

        function drainQueue() {
            if (draining) {
                return
            }
            var timeout = runTimeout(cleanUpNextTick);
            draining = true;
            var len = queue.length;
            while (len) {
                currentQueue = queue;
                queue = [];
                while (++queueIndex < len) {
                    if (currentQueue) {
                        currentQueue[queueIndex].run()
                    }
                }
                queueIndex = -1;
                len = queue.length
            }
            currentQueue = null;
            draining = false;
            runClearTimeout(timeout)
        }
        process.nextTick = function (fun) {
            var args = new Array(arguments.length - 1);
            if (arguments.length > 1) {
                for (var i = 1; i < arguments.length; i++) {
                    args[i - 1] = arguments[i]
                }
            }
            queue.push(new Item(fun, args));
            if (queue.length === 1 && !draining) {
                runTimeout(drainQueue)
            }
        };

        function Item(fun, array) {
            this.fun = fun;
            this.array = array
        }
        Item.prototype.run = function () {
            this.fun.apply(null, this.array)
        };
        process.title = "browser";
        process.browser = true;
        process.env = {};
        process.argv = [];
        process.version = "";
        process.versions = {};

        function noop() {}
        process.on = noop;
        process.addListener = noop;
        process.once = noop;
        process.off = noop;
        process.removeListener = noop;
        process.removeAllListeners = noop;
        process.emit = noop;
        process.prependListener = noop;
        process.prependOnceListener = noop;
        process.listeners = function (name) {
            return []
        };
        process.binding = function (name) {
            throw new Error("process.binding is not supported")
        };
        process.cwd = function () {
            return "/"
        };
        process.chdir = function (dir) {
            throw new Error("process.chdir is not supported")
        };
        process.umask = function () {
            return 0
        }
    }, {}],
    61: [function (require, module, exports) {
        (function (global) {
            (function (root) {
                var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
                var freeModule = typeof module == "object" && module && !module.nodeType && module;
                var freeGlobal = typeof global == "object" && global;
                if (freeGlobal.global === freeGlobal || freeGlobal.window === freeGlobal || freeGlobal.self === freeGlobal) {
                    root = freeGlobal
                }
                var punycode, maxInt = 2147483647,
                    base = 36,
                    tMin = 1,
                    tMax = 26,
                    skew = 38,
                    damp = 700,
                    initialBias = 72,
                    initialN = 128,
                    delimiter = "-",
                    regexPunycode = /^xn--/,
                    regexNonASCII = /[^\x20-\x7E]/,
                    regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g,
                    errors = {
                        overflow: "Overflow: input needs wider integers to process",
                        "not-basic": "Illegal input >= 0x80 (not a basic code point)",
                        "invalid-input": "Invalid input"
                    },
                    baseMinusTMin = base - tMin,
                    floor = Math.floor,
                    stringFromCharCode = String.fromCharCode,
                    key;

                function error(type) {
                    throw new RangeError(errors[type])
                }

                function map(array, fn) {
                    var length = array.length;
                    var result = [];
                    while (length--) {
                        result[length] = fn(array[length])
                    }
                    return result
                }

                function mapDomain(string, fn) {
                    var parts = string.split("@");
                    var result = "";
                    if (parts.length > 1) {
                        result = parts[0] + "@";
                        string = parts[1]
                    }
                    string = string.replace(regexSeparators, ".");
                    var labels = string.split(".");
                    var encoded = map(labels, fn).join(".");
                    return result + encoded
                }

                function ucs2decode(string) {
                    var output = [],
                        counter = 0,
                        length = string.length,
                        value, extra;
                    while (counter < length) {
                        value = string.charCodeAt(counter++);
                        if (value >= 55296 && value <= 56319 && counter < length) {
                            extra = string.charCodeAt(counter++);
                            if ((extra & 64512) == 56320) {
                                output.push(((value & 1023) << 10) + (extra & 1023) + 65536)
                            } else {
                                output.push(value);
                                counter--
                            }
                        } else {
                            output.push(value)
                        }
                    }
                    return output
                }

                function ucs2encode(array) {
                    return map(array, function (value) {
                        var output = "";
                        if (value > 65535) {
                            value -= 65536;
                            output += stringFromCharCode(value >>> 10 & 1023 | 55296);
                            value = 56320 | value & 1023
                        }
                        output += stringFromCharCode(value);
                        return output
                    }).join("")
                }

                function basicToDigit(codePoint) {
                    if (codePoint - 48 < 10) {
                        return codePoint - 22
                    }
                    if (codePoint - 65 < 26) {
                        return codePoint - 65
                    }
                    if (codePoint - 97 < 26) {
                        return codePoint - 97
                    }
                    return base
                }

                function digitToBasic(digit, flag) {
                    return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5)
                }

                function adapt(delta, numPoints, firstTime) {
                    var k = 0;
                    delta = firstTime ? floor(delta / damp) : delta >> 1;
                    delta += floor(delta / numPoints);
                    for (; delta > baseMinusTMin * tMax >> 1; k += base) {
                        delta = floor(delta / baseMinusTMin)
                    }
                    return floor(k + (baseMinusTMin + 1) * delta / (delta + skew))
                }

                function decode(input) {
                    var output = [],
                        inputLength = input.length,
                        out, i = 0,
                        n = initialN,
                        bias = initialBias,
                        basic, j, index, oldi, w, k, digit, t, baseMinusT;
                    basic = input.lastIndexOf(delimiter);
                    if (basic < 0) {
                        basic = 0
                    }
                    for (j = 0; j < basic; ++j) {
                        if (input.charCodeAt(j) >= 128) {
                            error("not-basic")
                        }
                        output.push(input.charCodeAt(j))
                    }
                    for (index = basic > 0 ? basic + 1 : 0; index < inputLength;) {
                        for (oldi = i, w = 1, k = base;; k += base) {
                            if (index >= inputLength) {
                                error("invalid-input")
                            }
                            digit = basicToDigit(input.charCodeAt(index++));
                            if (digit >= base || digit > floor((maxInt - i) / w)) {
                                error("overflow")
                            }
                            i += digit * w;
                            t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
                            if (digit < t) {
                                break
                            }
                            baseMinusT = base - t;
                            if (w > floor(maxInt / baseMinusT)) {
                                error("overflow")
                            }
                            w *= baseMinusT
                        }
                        out = output.length + 1;
                        bias = adapt(i - oldi, out, oldi == 0);
                        if (floor(i / out) > maxInt - n) {
                            error("overflow")
                        }
                        n += floor(i / out);
                        i %= out;
                        output.splice(i++, 0, n)
                    }
                    return ucs2encode(output)
                }

                function encode(input) {
                    var n, delta, handledCPCount, basicLength, bias, j, m, q, k, t, currentValue, output = [],
                        inputLength, handledCPCountPlusOne, baseMinusT, qMinusT;
                    input = ucs2decode(input);
                    inputLength = input.length;
                    n = initialN;
                    delta = 0;
                    bias = initialBias;
                    for (j = 0; j < inputLength; ++j) {
                        currentValue = input[j];
                        if (currentValue < 128) {
                            output.push(stringFromCharCode(currentValue))
                        }
                    }
                    handledCPCount = basicLength = output.length;
                    if (basicLength) {
                        output.push(delimiter)
                    }
                    while (handledCPCount < inputLength) {
                        for (m = maxInt, j = 0; j < inputLength; ++j) {
                            currentValue = input[j];
                            if (currentValue >= n && currentValue < m) {
                                m = currentValue
                            }
                        }
                        handledCPCountPlusOne = handledCPCount + 1;
                        if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
                            error("overflow")
                        }
                        delta += (m - n) * handledCPCountPlusOne;
                        n = m;
                        for (j = 0; j < inputLength; ++j) {
                            currentValue = input[j];
                            if (currentValue < n && ++delta > maxInt) {
                                error("overflow")
                            }
                            if (currentValue == n) {
                                for (q = delta, k = base;; k += base) {
                                    t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
                                    if (q < t) {
                                        break
                                    }
                                    qMinusT = q - t;
                                    baseMinusT = base - t;
                                    output.push(stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0)));
                                    q = floor(qMinusT / baseMinusT)
                                }
                                output.push(stringFromCharCode(digitToBasic(q, 0)));
                                bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
                                delta = 0;
                                ++handledCPCount
                            }
                        }++delta;
                        ++n
                    }
                    return output.join("")
                }

                function toUnicode(input) {
                    return mapDomain(input, function (string) {
                        return regexPunycode.test(string) ? decode(string.slice(4).toLowerCase()) : string
                    })
                }

                function toASCII(input) {
                    return mapDomain(input, function (string) {
                        return regexNonASCII.test(string) ? "xn--" + encode(string) : string
                    })
                }
                punycode = {
                    version: "1.4.1",
                    ucs2: {
                        decode: ucs2decode,
                        encode: ucs2encode
                    },
                    decode: decode,
                    encode: encode,
                    toASCII: toASCII,
                    toUnicode: toUnicode
                };
                if (typeof define == "function" && typeof define.amd == "object" && define.amd) {
                    define("punycode", function () {
                        return punycode
                    })
                } else if (freeExports && freeModule) {
                    if (module.exports == freeExports) {
                        freeModule.exports = punycode
                    } else {
                        for (key in punycode) {
                            punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key])
                        }
                    }
                } else {
                    root.punycode = punycode
                }
            })(this)
        }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
    }, {}],
    62: [function (require, module, exports) {
        "use strict";

        function hasOwnProperty(obj, prop) {
            return Object.prototype.hasOwnProperty.call(obj, prop)
        }
        module.exports = function (qs, sep, eq, options) {
            sep = sep || "&";
            eq = eq || "=";
            var obj = {};
            if (typeof qs !== "string" || qs.length === 0) {
                return obj
            }
            var regexp = /\+/g;
            qs = qs.split(sep);
            var maxKeys = 1e3;
            if (options && typeof options.maxKeys === "number") {
                maxKeys = options.maxKeys
            }
            var len = qs.length;
            if (maxKeys > 0 && len > maxKeys) {
                len = maxKeys
            }
            for (var i = 0; i < len; ++i) {
                var x = qs[i].replace(regexp, "%20"),
                    idx = x.indexOf(eq),
                    kstr, vstr, k, v;
                if (idx >= 0) {
                    kstr = x.substr(0, idx);
                    vstr = x.substr(idx + 1)
                } else {
                    kstr = x;
                    vstr = ""
                }
                k = decodeURIComponent(kstr);
                v = decodeURIComponent(vstr);
                if (!hasOwnProperty(obj, k)) {
                    obj[k] = v
                } else if (isArray(obj[k])) {
                    obj[k].push(v)
                } else {
                    obj[k] = [obj[k], v]
                }
            }
            return obj
        };
        var isArray = Array.isArray || function (xs) {
            return Object.prototype.toString.call(xs) === "[object Array]"
        }
    }, {}],
    63: [function (require, module, exports) {
        "use strict";
        var stringifyPrimitive = function (v) {
            switch (typeof v) {
                case "string":
                    return v;
                case "boolean":
                    return v ? "true" : "false";
                case "number":
                    return isFinite(v) ? v : "";
                default:
                    return ""
            }
        };
        module.exports = function (obj, sep, eq, name) {
            sep = sep || "&";
            eq = eq || "=";
            if (obj === null) {
                obj = undefined
            }
            if (typeof obj === "object") {
                return map(objectKeys(obj), function (k) {
                    var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
                    if (isArray(obj[k])) {
                        return map(obj[k], function (v) {
                            return ks + encodeURIComponent(stringifyPrimitive(v))
                        }).join(sep)
                    } else {
                        return ks + encodeURIComponent(stringifyPrimitive(obj[k]))
                    }
                }).join(sep)
            }
            if (!name) return "";
            return encodeURIComponent(stringifyPrimitive(name)) + eq + encodeURIComponent(stringifyPrimitive(obj))
        };
        var isArray = Array.isArray || function (xs) {
            return Object.prototype.toString.call(xs) === "[object Array]"
        };

        function map(xs, f) {
            if (xs.map) return xs.map(f);
            var res = [];
            for (var i = 0; i < xs.length; i++) {
                res.push(f(xs[i], i))
            }
            return res
        }
        var objectKeys = Object.keys || function (obj) {
            var res = [];
            for (var key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key)
            }
            return res
        }
    }, {}],
    64: [function (require, module, exports) {
        "use strict";
        exports.decode = exports.parse = require("./decode");
        exports.encode = exports.stringify = require("./encode")
    }, {
        "./decode": 62,
        "./encode": 63
    }],
    65: [function (require, module, exports) {
        var isHexPrefixed = require("is-hex-prefixed");
        module.exports = function stripHexPrefix(str) {
            if (typeof str !== "string") {
                return str
            }
            return isHexPrefixed(str) ? str.slice(2) : str
        }
    }, {
        "is-hex-prefixed": 56
    }],
    66: [function (require, module, exports) {
        var Blockchain = {
            getBlockByNumber: function (blockNumber, provider, callback) {
                var params = [blockNumber, true];
                provider.sendAsync({
                    jsonrpc: "2.0",
                    method: "eth_getBlockByNumber",
                    params: params,
                    id: Date.now()
                }, callback)
            },
            getBlockByHash: function (blockHash, provider, callback) {
                var params = [blockHash, true];
                provider.sendAsync({
                    jsonrpc: "2.0",
                    method: "eth_getBlockByHash",
                    params: params,
                    id: Date.now()
                }, callback)
            },
            parse: function (uri) {
                var parsed = {};
                if (uri.indexOf("blockchain://") != 0) return parsed;
                uri = uri.replace("blockchain://", "");
                var pieces = uri.split("/block/");
                parsed.genesis_hash = "0x" + pieces[0];
                parsed.block_hash = "0x" + pieces[1];
                return parsed
            },
            asURI: function (provider, callback) {
                var self = this;
                var genesis;
                self.getBlockByNumber("0x0", provider, function (err, response) {
                    if (err) return callback(err);
                    genesis = response.result;
                    self.getBlockByNumber("latest", provider, function (err, response) {
                        if (err) return callback(err);
                        latest = response.result;
                        var url = "blockchain://" + genesis.hash.replace("0x", "") + "/block/" + latest.hash.replace("0x", "");
                        callback(null, url)
                    })
                })
            },
            matches: function (uri, provider, callback) {
                var self = this;
                uri = self.parse(uri);
                var expected_genesis = uri.genesis_hash;
                var expected_block = uri.block_hash;
                self.getBlockByNumber("0x0", provider, function (err, response) {
                    if (err) return callback(err);
                    var block = response.result;
                    if (block.hash != expected_genesis) return callback(null, false);
                    self.getBlockByHash(expected_block, provider, function (err, response) {
                        var block = response.result;
                        if (err || block == null) {
                            return callback(null, false)
                        }
                        callback(null, true)
                    })
                })
            }
        };
        module.exports = Blockchain
    }, {}],
    67: [function (require, module, exports) {
        var sha3 = require("crypto-js/sha3");
        var pkgVersion = require("./package.json").version;
        var Ajv = require("ajv");
        var contractObjectSchema = require("./spec/contract-object.spec.json");
        var networkObjectSchema = require("./spec/network-object.spec.json");
        var abiSchema = require("./spec/abi.spec.json");
        var properties = {
            contractName: {
                sources: ["contractName", "contract_name"]
            },
            abi: {
                sources: ["abi", "interface"],
                transform: function (value) {
                    if (typeof value === "string") {
                        try {
                            value = JSON.parse(value)
                        } catch (e) {
                            value = undefined
                        }
                    }
                    return value
                }
            },
            bytecode: {
                sources: ["bytecode", "binary", "unlinked_binary", "evm.bytecode.object"],
                transform: function (value) {
                    if (value && value.indexOf("0x") != 0) {
                        value = "0x" + value
                    }
                    return value
                }
            },
            deployedBytecode: {
                sources: ["deployedBytecode", "runtimeBytecode", "evm.deployedBytecode.object"],
                transform: function (value) {
                    if (value && value.indexOf("0x") != 0) {
                        value = "0x" + value
                    }
                    return value
                }
            },
            sourceMap: {
                sources: ["sourceMap", "srcmap", "evm.bytecode.sourceMap"]
            },
            deployedSourceMap: {
                sources: ["deployedSourceMap", "srcmapRuntime", "evm.deployedBytecode.sourceMap"]
            },
            source: {},
            sourcePath: {},
            ast: {},
            legacyAST: {
                transform: function (value, obj) {
                    var schemaVersion = obj.schemaVersion || "0.0.0";
                    if (schemaVersion[0] < 2) {
                        return obj.ast
                    } else {
                        return value
                    }
                }
            },
            compiler: {},
            networks: {
                transform: function (value) {
                    if (value === undefined) {
                        value = {}
                    }
                    return value
                }
            },
            schemaVersion: {
                sources: ["schemaVersion", "schema_version"]
            },
            updatedAt: {
                sources: ["updatedAt", "updated_at"],
                transform: function (value) {
                    if (typeof value === "number") {
                        value = new Date(value).toISOString()
                    }
                    return value
                }
            }
        };

        function getter(key, transform) {
            if (transform === undefined) {
                transform = function (x) {
                    return x
                }
            }
            return function (obj) {
                try {
                    return transform(obj[key])
                } catch (e) {
                    return undefined
                }
            }
        }

        function chain() {
            var getters = Array.prototype.slice.call(arguments);
            return function (obj) {
                return getters.reduce(function (cur, get) {
                    return get(cur)
                }, obj)
            }
        }
        var TruffleContractSchema = {
            validate: function (contractObj) {
                var ajv = new Ajv({
                    useDefaults: true
                });
                ajv.addSchema(abiSchema);
                ajv.addSchema(networkObjectSchema);
                ajv.addSchema(contractObjectSchema);
                if (ajv.validate("contract-object.spec.json", contractObj)) {
                    return contractObj
                } else {
                    throw ajv.errors
                }
            },
            normalize: function (objDirty, options) {
                options = options || {};
                var normalized = {};
                Object.keys(properties).forEach(function (key) {
                    var property = properties[key];
                    var value;
                    var sources = property.sources || [key];
                    for (var i = 0; value === undefined && i < sources.length; i++) {
                        var source = sources[i];
                        if (typeof source === "string") {
                            var traversals = source.split(".").map(function (k) {
                                return getter(k)
                            });
                            source = chain.apply(null, traversals)
                        }
                        value = source(objDirty)
                    }
                    if (property.transform) {
                        value = property.transform(value, objDirty)
                    }
                    normalized[key] = value
                });
                Object.keys(objDirty).forEach(function (key) {
                    if (key.indexOf("x-") === 0) {
                        normalized[key] = getter(key)(objDirty)
                    }
                });
                normalized.schemaVersion = pkgVersion;
                if (options.validate) {
                    this.validate(normalized)
                }
                return normalized
            }
        };
        module.exports = TruffleContractSchema
    }, {
        "./package.json": 68,
        "./spec/abi.spec.json": 69,
        "./spec/contract-object.spec.json": 70,
        "./spec/network-object.spec.json": 71,
        ajv: 4,
        "crypto-js/sha3": 49
    }],
    68: [function (require, module, exports) {
        module.exports = {
            _from: "truffle-contract-schema@^2.0.0",
            _id: "truffle-contract-schema@2.0.0",
            _inBundle: false,
            _integrity: "sha512-nLlspmu1GKDaluWksBwitHi/7Z3IpRjmBYeO9N+T1nVJD2V4IWJaptCKP1NqnPiJA+FChB7+F7pI6Br51/FtXQ==",
            _location: "/truffle-contract-schema",
            _phantomChildren: {},
            _requested: {
                type: "range",
                registry: true,
                raw: "truffle-contract-schema@^2.0.0",
                name: "truffle-contract-schema",
                escapedName: "truffle-contract-schema",
                rawSpec: "^2.0.0",
                saveSpec: null,
                fetchSpec: "^2.0.0"
            },
            _requiredBy: ["/"],
            _resolved: "https://registry.npmjs.org/truffle-contract-schema/-/truffle-contract-schema-2.0.0.tgz",
            _shasum: "535378c0b6a7f58011ea8d84f57771771cb45163",
            _spec: "truffle-contract-schema@^2.0.0",
            _where: "/Users/gnidan/src/work/release/dependencies/truffle-contract",
            author: {
                name: "Tim Coulter",
                email: "tim.coulter@consensys.net"
            },
            bugs: {
                url: "https://github.com/trufflesuite/truffle-schema/issues"
            },
            bundleDependencies: false,
            dependencies: {
                ajv: "^5.1.1",
                "crypto-js": "^3.1.9-1",
                debug: "^3.1.0"
            },
            deprecated: false,
            description: "JSON schema for contract artifacts",
            devDependencies: {
                mocha: "^3.2.0",
                solc: "^0.4.16"
            },
            homepage: "https://github.com/trufflesuite/truffle-schema#readme",
            keywords: ["ethereum", "json", "schema", "contract", "artifacts"],
            license: "MIT",
            main: "index.js",
            name: "truffle-contract-schema",
            repository: {
                type: "git",
                url: "git+https://github.com/trufflesuite/truffle-schema.git"
            },
            scripts: {
                test: "mocha"
            },
            version: "2.0.0"
        }
    }, {}],
    69: [function (require, module, exports) {
        module.exports = {
            id: "abi.spec.json",
            $schema: "http://json-schema.org/schema#",
            title: "ABI",
            type: "array",
            items: {
                oneOf: [{
                    $ref: "#/definitions/Event"
                }, {
                    $ref: "#/definitions/ConstructorFunction"
                }, {
                    $ref: "#/definitions/FallbackFunction"
                }, {
                    $ref: "#/definitions/NormalFunction"
                }]
            },
            definitions: {
                Name: {
                    type: "string",
                    pattern: "^$|^[a-zA-Z_\\$][a-zA-Z_\\$0-9]*$"
                },
                Type: {
                    type: "string",
                    oneOf: [{
                        pattern: "^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?(\\[[0-9]*\\])?$"
                    }, {
                        pattern: "^address(\\[[0-9]*\\])?$"
                    }, {
                        pattern: "^bool(\\[[0-9]*\\])?$"
                    }, {
                        pattern: "^u?fixed(0x8|8x0|0x16|8x8|16x0|0x24|8x16|16x8|24x0|0x32|8x24|16x16|24x8|32x0|0x40|8x32|16x24|24x16|32x8|40x0|0x48|8x40|16x32|24x24|32x16|40x8|48x0|0x56|8x48|16x40|24x32|32x24|40x16|48x8|56x0|0x64|8x56|16x48|24x40|32x32|40x24|48x16|56x8|64x0|0x72|8x64|16x56|24x48|32x40|40x32|48x24|56x16|64x8|72x0|0x80|8x72|16x64|24x56|32x48|40x40|48x32|56x24|64x16|72x8|80x0|0x88|8x80|16x72|24x64|32x56|40x48|48x40|56x32|64x24|72x16|80x8|88x0|0x96|8x88|16x80|24x72|32x64|40x56|48x48|56x40|64x32|72x24|80x16|88x8|96x0|0x104|8x96|16x88|24x80|32x72|40x64|48x56|56x48|64x40|72x32|80x24|88x16|96x8|104x0|0x112|8x104|16x96|24x88|32x80|40x72|48x64|56x56|64x48|72x40|80x32|88x24|96x16|104x8|112x0|0x120|8x112|16x104|24x96|32x88|40x80|48x72|56x64|64x56|72x48|80x40|88x32|96x24|104x16|112x8|120x0|0x128|8x120|16x112|24x104|32x96|40x88|48x80|56x72|64x64|72x56|80x48|88x40|96x32|104x24|112x16|120x8|128x0|0x136|8x128|16x120|24x112|32x104|40x96|48x88|56x80|64x72|72x64|80x56|88x48|96x40|104x32|112x24|120x16|128x8|136x0|0x144|8x136|16x128|24x120|32x112|40x104|48x96|56x88|64x80|72x72|80x64|88x56|96x48|104x40|112x32|120x24|128x16|136x8|144x0|0x152|8x144|16x136|24x128|32x120|40x112|48x104|56x96|64x88|72x80|80x72|88x64|96x56|104x48|112x40|120x32|128x24|136x16|144x8|152x0|0x160|8x152|16x144|24x136|32x128|40x120|48x112|56x104|64x96|72x88|80x80|88x72|96x64|104x56|112x48|120x40|128x32|136x24|144x16|152x8|160x0|0x168|8x160|16x152|24x144|32x136|40x128|48x120|56x112|64x104|72x96|80x88|88x80|96x72|104x64|112x56|120x48|128x40|136x32|144x24|152x16|160x8|168x0|0x176|8x168|16x160|24x152|32x144|40x136|48x128|56x120|64x112|72x104|80x96|88x88|96x80|104x72|112x64|120x56|128x48|136x40|144x32|152x24|160x16|168x8|176x0|0x184|8x176|16x168|24x160|32x152|40x144|48x136|56x128|64x120|72x112|80x104|88x96|96x88|104x80|112x72|120x64|128x56|136x48|144x40|152x32|160x24|168x16|176x8|184x0|0x192|8x184|16x176|24x168|32x160|40x152|48x144|56x136|64x128|72x120|80x112|88x104|96x96|104x88|112x80|120x72|128x64|136x56|144x48|152x40|160x32|168x24|176x16|184x8|192x0|0x200|8x192|16x184|24x176|32x168|40x160|48x152|56x144|64x136|72x128|80x120|88x112|96x104|104x96|112x88|120x80|128x72|136x64|144x56|152x48|160x40|168x32|176x24|184x16|192x8|200x0|0x208|8x200|16x192|24x184|32x176|40x168|48x160|56x152|64x144|72x136|80x128|88x120|96x112|104x104|112x96|120x88|128x80|136x72|144x64|152x56|160x48|168x40|176x32|184x24|192x16|200x8|208x0|0x216|8x208|16x200|24x192|32x184|40x176|48x168|56x160|64x152|72x144|80x136|88x128|96x120|104x112|112x104|120x96|128x88|136x80|144x72|152x64|160x56|168x48|176x40|184x32|192x24|200x16|208x8|216x0|0x224|8x216|16x208|24x200|32x192|40x184|48x176|56x168|64x160|72x152|80x144|88x136|96x128|104x120|112x112|120x104|128x96|136x88|144x80|152x72|160x64|168x56|176x48|184x40|192x32|200x24|208x16|216x8|224x0|0x232|8x224|16x216|24x208|32x200|40x192|48x184|56x176|64x168|72x160|80x152|88x144|96x136|104x128|112x120|120x112|128x104|136x96|144x88|152x80|160x72|168x64|176x56|184x48|192x40|200x32|208x24|216x16|224x8|232x0|0x240|8x232|16x224|24x216|32x208|40x200|48x192|56x184|64x176|72x168|80x160|88x152|96x144|104x136|112x128|120x120|128x112|136x104|144x96|152x88|160x80|168x72|176x64|184x56|192x48|200x40|208x32|216x24|224x16|232x8|240x0|0x248|8x240|16x232|24x224|32x216|40x208|48x200|56x192|64x184|72x176|80x168|88x160|96x152|104x144|112x136|120x128|128x120|136x112|144x104|152x96|160x88|168x80|176x72|184x64|192x56|200x48|208x40|216x32|224x24|232x16|240x8|248x0|0x256|8x248|16x240|24x232|32x224|40x216|48x208|56x200|64x192|72x184|80x176|88x168|96x160|104x152|112x144|120x136|128x128|136x120|144x112|152x104|160x96|168x88|176x80|184x72|192x64|200x56|208x48|216x40|224x32|232x24|240x16|248x8|256x0)?(\\[[0-9]*\\])?$"
                    }, {
                        pattern: "^bytes(0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31|32)(\\[[0-9]*\\])?"
                    }, {
                        pattern: "^bytes$"
                    }, {
                        pattern: "^function(\\[[0-9]*\\])?$"
                    }, {
                        pattern: "^string$"
                    }]
                },
                StateMutability: {
                    type: "string",
                    enum: ["pure", "view", "nonpayable", "payable"]
                },
                NormalFunction: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["function"],
                            default: "function"
                        },
                        name: {
                            $ref: "#/definitions/Name"
                        },
                        inputs: {
                            type: "array",
                            items: {
                                $ref: "#/definitions/Parameter"
                            }
                        },
                        outputs: {
                            type: "array",
                            items: {
                                $ref: "#/definitions/Parameter"
                            },
                            default: []
                        },
                        stateMutability: {
                            $ref: "#/definitions/StateMutability"
                        },
                        constant: {
                            type: "boolean"
                        },
                        payable: {
                            type: "boolean",
                            default: false
                        }
                    },
                    required: ["name", "inputs", "constant"],
                    additionalProperties: false
                },
                ConstructorFunction: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["constructor"]
                        },
                        inputs: {
                            type: "array",
                            items: {
                                $ref: "#/definitions/Parameter"
                            }
                        },
                        payable: {
                            type: "boolean",
                            default: false
                        }
                    },
                    required: ["type", "inputs"],
                    additionalProperties: false
                },
                FallbackFunction: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["fallback"]
                        },
                        constant: {
                            type: "boolean"
                        },
                        payable: {
                            type: "boolean",
                            default: false
                        }
                    },
                    required: ["type"],
                    additionalProperties: false
                },
                Event: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["event"]
                        },
                        name: {
                            $ref: "#/definitions/Name"
                        },
                        inputs: {
                            type: "array",
                            items: {
                                $ref: "#/definitions/EventParameter"
                            }
                        },
                        anonymous: {
                            type: "boolean"
                        }
                    },
                    required: ["type", "name", "inputs", "anonymous"],
                    additionalProperties: false
                },
                Parameter: {
                    type: "object",
                    properties: {
                        name: {
                            $ref: "#/definitions/Name"
                        },
                        type: {
                            $ref: "#/definitions/Type"
                        }
                    },
                    required: ["name", "type"]
                },
                EventParameter: {
                    type: "object",
                    properties: {
                        name: {
                            $ref: "#/definitions/Name"
                        },
                        type: {
                            $ref: "#/definitions/Type"
                        },
                        indexed: {
                            type: "boolean"
                        }
                    },
                    required: ["name", "type", "indexed"]
                }
            }
        }
    }, {}],
    70: [function (require, module, exports) {
        module.exports = {
            id: "contract-object.spec.json",
            $schema: "http://json-schema.org/schema#",
            title: "Contract Object",
            description: "Describes a contract consumable by Truffle, possibly including deployed instances on networks",
            type: "object",
            properties: {
                contractName: {
                    allOf: [{
                        $ref: "#/definitions/ContractName"
                    }, {
                        description: "Name used to identify the contract",
                        default: "Contract"
                    }]
                },
                abi: {
                    allOf: [{
                        $ref: "abi.spec.json#"
                    }, {
                        description: "Interface description returned by compiler for source"
                    }]
                },
                bytecode: {
                    allOf: [{
                        $ref: "#/definitions/Bytecode"
                    }, {
                        description: "Bytecode sent as contract-creation transaction data, with unresolved link references"
                    }]
                },
                deployedBytecode: {
                    allOf: [{
                        $ref: "#/definitions/Bytecode"
                    }, {
                        description: "On-chain deployed contract bytecode, with unresolved link references"
                    }]
                },
                sourceMap: {
                    allOf: [{
                        $ref: "#/definitions/SourceMap"
                    }, {
                        description: "Source mapping for contract-creation transaction data bytecode"
                    }]
                },
                deployedSourceMap: {
                    allOf: [{
                        $ref: "#/definitions/SourceMap"
                    }, {
                        description: "Source mapping for contract bytecode"
                    }]
                },
                source: {
                    $ref: "#/definitions/Source"
                },
                sourcePath: {
                    $ref: "#/definitions/SourcePath"
                },
                ast: {
                    $ref: "#/definitions/AST"
                },
                legacyAST: {
                    $ref: "#/definitions/LegacyAST"
                },
                compiler: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string"
                        },
                        version: {
                            type: "string"
                        }
                    }
                },
                networks: {
                    patternProperties: {
                        "^[a-zA-Z0-9]+$": {
                            $ref: "network-object.spec.json#"
                        }
                    },
                    additionalProperties: false
                },
                schemaVersion: {
                    $ref: "#/definitions/SchemaVersion"
                },
                updatedAt: {
                    type: "string",
                    format: "date-time"
                }
            },
            required: ["abi"],
            patternProperties: {
                "^x-": {
                    anyOf: [{
                        type: "string"
                    }, {
                        type: "number"
                    }, {
                        type: "object"
                    }, {
                        type: "array"
                    }]
                }
            },
            additionalProperties: false,
            definitions: {
                ContractName: {
                    type: "string",
                    pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$"
                },
                Bytecode: {
                    type: "string",
                    pattern: "^0x0$|^0x([a-fA-F0-9]{2}|__.{38})+$"
                },
                Source: {
                    type: "string"
                },
                SourceMap: {
                    type: "string",
                    examples: ["315:637:1:-;;;452:55;;;;;;;-1:-1:-1;;;;;485:9:1;476:19;:8;:19;;;;;;;;;;498:5;476:27;;452:55;315:637;;;;;;;"]
                },
                SourcePath: {
                    type: "string"
                },
                AST: {
                    type: "object"
                },
                LegacyAST: {
                    type: "object"
                },
                SchemaVersion: {
                    type: "string",
                    pattern: "[0-9]+\\.[0-9]+\\.[0-9]+"
                }
            }
        }
    }, {}],
    71: [function (require, module, exports) {
        module.exports = {
            id: "network-object.spec.json",
            $schema: "http://json-schema.org/schema#",
            title: "Network Object",
            type: "object",
            properties: {
                address: {
                    $ref: "#/definitions/Address"
                },
                transactionHash: {
                    $ref: "#/definitions/TransactionHash"
                },
                events: {
                    type: "object",
                    patternProperties: {
                        "^0x[a-fA-F0-9]{64}$": {
                            $ref: "abi.spec.json#/definitions/Event"
                        }
                    },
                    additionalProperties: false
                },
                links: {
                    type: "object",
                    patternProperties: {
                        "^[a-zA-Z_][a-zA-Z0-9_]*$": {
                            $ref: "#/definitions/Link"
                        }
                    },
                    additionalProperties: false
                }
            },
            additionalProperties: false,
            definitions: {
                Address: {
                    type: "string",
                    pattern: "^0x[a-fA-F0-9]{40}$"
                },
                TransactionHash: {
                    type: "string",
                    pattern: "^0x[a-fA-F0-9]{64}$"
                },
                Link: {
                    type: "object",
                    properties: {
                        address: {
                            $ref: "#/definitions/Address"
                        },
                        events: {
                            type: "object",
                            patternProperties: {
                                "^0x[a-fA-F0-9]{64}$": {
                                    $ref: "abi.spec.json#/definitions/Event"
                                }
                            },
                            additionalProperties: false
                        }
                    }
                }
            }
        }
    }, {}],
    72: [function (require, module, exports) {
        function ExtendableBuiltin(cls) {
            function ExtendableBuiltin() {
                cls.apply(this, arguments)
            }
            ExtendableBuiltin.prototype = Object.create(cls.prototype);
            Object.setPrototypeOf(ExtendableBuiltin, cls);
            return ExtendableBuiltin
        }
        module.exports = ExtendableBuiltin
    }, {}],
    73: [function (require, module, exports) {
        var ExtendableBuiltin = require("./extendablebuiltin");
        var inherits = require("util").inherits;
        inherits(ExtendableError, ExtendableBuiltin(Error));

        function ExtendableError(message) {
            ExtendableError.super_.call(this);
            this.message = message;
            this.stack = new Error(message).stack;
            this.name = this.constructor.name
        }
        ExtendableError.prototype.formatForMocha = function () {
            this.message = this.message.replace(/\n/g, "\n     ")
        };
        module.exports = ExtendableError
    }, {
        "./extendablebuiltin": 72,
        util: 78
    }],
    74: [function (require, module, exports) {
        "use strict";
        var punycode = require("punycode");
        var util = require("./util");
        exports.parse = urlParse;
        exports.resolve = urlResolve;
        exports.resolveObject = urlResolveObject;
        exports.format = urlFormat;
        exports.Url = Url;

        function Url() {
            this.protocol = null;
            this.slashes = null;
            this.auth = null;
            this.host = null;
            this.port = null;
            this.hostname = null;
            this.hash = null;
            this.search = null;
            this.query = null;
            this.pathname = null;
            this.path = null;
            this.href = null
        }
        var protocolPattern = /^([a-z0-9.+-]+:)/i,
            portPattern = /:[0-9]*$/,
            simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,
            delims = ["<", ">", '"', "`", " ", "\r", "\n", "\t"],
            unwise = ["{", "}", "|", "\\", "^", "`"].concat(delims),
            autoEscape = ["'"].concat(unwise),
            nonHostChars = ["%", "/", "?", ";", "#"].concat(autoEscape),
            hostEndingChars = ["/", "?", "#"],
            hostnameMaxLen = 255,
            hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/,
            hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/,
            unsafeProtocol = {
                javascript: true,
                "javascript:": true
            },
            hostlessProtocol = {
                javascript: true,
                "javascript:": true
            },
            slashedProtocol = {
                http: true,
                https: true,
                ftp: true,
                gopher: true,
                file: true,
                "http:": true,
                "https:": true,
                "ftp:": true,
                "gopher:": true,
                "file:": true
            },
            querystring = require("querystring");

        function urlParse(url, parseQueryString, slashesDenoteHost) {
            if (url && util.isObject(url) && url instanceof Url) return url;
            var u = new Url;
            u.parse(url, parseQueryString, slashesDenoteHost);
            return u
        }
        Url.prototype.parse = function (url, parseQueryString, slashesDenoteHost) {
            if (!util.isString(url)) {
                throw new TypeError("Parameter 'url' must be a string, not " + typeof url)
            }
            var queryIndex = url.indexOf("?"),
                splitter = queryIndex !== -1 && queryIndex < url.indexOf("#") ? "?" : "#",
                uSplit = url.split(splitter),
                slashRegex = /\\/g;
            uSplit[0] = uSplit[0].replace(slashRegex, "/");
            url = uSplit.join(splitter);
            var rest = url;
            rest = rest.trim();
            if (!slashesDenoteHost && url.split("#").length === 1) {
                var simplePath = simplePathPattern.exec(rest);
                if (simplePath) {
                    this.path = rest;
                    this.href = rest;
                    this.pathname = simplePath[1];
                    if (simplePath[2]) {
                        this.search = simplePath[2];
                        if (parseQueryString) {
                            this.query = querystring.parse(this.search.substr(1))
                        } else {
                            this.query = this.search.substr(1)
                        }
                    } else if (parseQueryString) {
                        this.search = "";
                        this.query = {}
                    }
                    return this
                }
            }
            var proto = protocolPattern.exec(rest);
            if (proto) {
                proto = proto[0];
                var lowerProto = proto.toLowerCase();
                this.protocol = lowerProto;
                rest = rest.substr(proto.length)
            }
            if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
                var slashes = rest.substr(0, 2) === "//";
                if (slashes && !(proto && hostlessProtocol[proto])) {
                    rest = rest.substr(2);
                    this.slashes = true
                }
            }
            if (!hostlessProtocol[proto] && (slashes || proto && !slashedProtocol[proto])) {
                var hostEnd = -1;
                for (var i = 0; i < hostEndingChars.length; i++) {
                    var hec = rest.indexOf(hostEndingChars[i]);
                    if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) hostEnd = hec
                }
                var auth, atSign;
                if (hostEnd === -1) {
                    atSign = rest.lastIndexOf("@")
                } else {
                    atSign = rest.lastIndexOf("@", hostEnd)
                }
                if (atSign !== -1) {
                    auth = rest.slice(0, atSign);
                    rest = rest.slice(atSign + 1);
                    this.auth = decodeURIComponent(auth)
                }
                hostEnd = -1;
                for (var i = 0; i < nonHostChars.length; i++) {
                    var hec = rest.indexOf(nonHostChars[i]);
                    if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) hostEnd = hec
                }
                if (hostEnd === -1) hostEnd = rest.length;
                this.host = rest.slice(0, hostEnd);
                rest = rest.slice(hostEnd);
                this.parseHost();
                this.hostname = this.hostname || "";
                var ipv6Hostname = this.hostname[0] === "[" && this.hostname[this.hostname.length - 1] === "]";
                if (!ipv6Hostname) {
                    var hostparts = this.hostname.split(/\./);
                    for (var i = 0, l = hostparts.length; i < l; i++) {
                        var part = hostparts[i];
                        if (!part) continue;
                        if (!part.match(hostnamePartPattern)) {
                            var newpart = "";
                            for (var j = 0, k = part.length; j < k; j++) {
                                if (part.charCodeAt(j) > 127) {
                                    newpart += "x"
                                } else {
                                    newpart += part[j]
                                }
                            }
                            if (!newpart.match(hostnamePartPattern)) {
                                var validParts = hostparts.slice(0, i);
                                var notHost = hostparts.slice(i + 1);
                                var bit = part.match(hostnamePartStart);
                                if (bit) {
                                    validParts.push(bit[1]);
                                    notHost.unshift(bit[2])
                                }
                                if (notHost.length) {
                                    rest = "/" + notHost.join(".") + rest
                                }
                                this.hostname = validParts.join(".");
                                break
                            }
                        }
                    }
                }
                if (this.hostname.length > hostnameMaxLen) {
                    this.hostname = ""
                } else {
                    this.hostname = this.hostname.toLowerCase()
                }
                if (!ipv6Hostname) {
                    this.hostname = punycode.toASCII(this.hostname)
                }
                var p = this.port ? ":" + this.port : "";
                var h = this.hostname || "";
                this.host = h + p;
                this.href += this.host;
                if (ipv6Hostname) {
                    this.hostname = this.hostname.substr(1, this.hostname.length - 2);
                    if (rest[0] !== "/") {
                        rest = "/" + rest
                    }
                }
            }
            if (!unsafeProtocol[lowerProto]) {
                for (var i = 0, l = autoEscape.length; i < l; i++) {
                    var ae = autoEscape[i];
                    if (rest.indexOf(ae) === -1) continue;
                    var esc = encodeURIComponent(ae);
                    if (esc === ae) {
                        esc = escape(ae)
                    }
                    rest = rest.split(ae).join(esc)
                }
            }
            var hash = rest.indexOf("#");
            if (hash !== -1) {
                this.hash = rest.substr(hash);
                rest = rest.slice(0, hash)
            }
            var qm = rest.indexOf("?");
            if (qm !== -1) {
                this.search = rest.substr(qm);
                this.query = rest.substr(qm + 1);
                if (parseQueryString) {
                    this.query = querystring.parse(this.query)
                }
                rest = rest.slice(0, qm)
            } else if (parseQueryString) {
                this.search = "";
                this.query = {}
            }
            if (rest) this.pathname = rest;
            if (slashedProtocol[lowerProto] && this.hostname && !this.pathname) {
                this.pathname = "/"
            }
            if (this.pathname || this.search) {
                var p = this.pathname || "";
                var s = this.search || "";
                this.path = p + s
            }
            this.href = this.format();
            return this
        };

        function urlFormat(obj) {
            if (util.isString(obj)) obj = urlParse(obj);
            if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
            return obj.format()
        }
        Url.prototype.format = function () {
            var auth = this.auth || "";
            if (auth) {
                auth = encodeURIComponent(auth);
                auth = auth.replace(/%3A/i, ":");
                auth += "@"
            }
            var protocol = this.protocol || "",
                pathname = this.pathname || "",
                hash = this.hash || "",
                host = false,
                query = "";
            if (this.host) {
                host = auth + this.host
            } else if (this.hostname) {
                host = auth + (this.hostname.indexOf(":") === -1 ? this.hostname : "[" + this.hostname + "]");
                if (this.port) {
                    host += ":" + this.port
                }
            }
            if (this.query && util.isObject(this.query) && Object.keys(this.query).length) {
                query = querystring.stringify(this.query)
            }
            var search = this.search || query && "?" + query || "";
            if (protocol && protocol.substr(-1) !== ":") protocol += ":";
            if (this.slashes || (!protocol || slashedProtocol[protocol]) && host !== false) {
                host = "//" + (host || "");
                if (pathname && pathname.charAt(0) !== "/") pathname = "/" + pathname
            } else if (!host) {
                host = ""
            }
            if (hash && hash.charAt(0) !== "#") hash = "#" + hash;
            if (search && search.charAt(0) !== "?") search = "?" + search;
            pathname = pathname.replace(/[?#]/g, function (match) {
                return encodeURIComponent(match)
            });
            search = search.replace("#", "%23");
            return protocol + host + pathname + search + hash
        };

        function urlResolve(source, relative) {
            return urlParse(source, false, true).resolve(relative)
        }
        Url.prototype.resolve = function (relative) {
            return this.resolveObject(urlParse(relative, false, true)).format()
        };

        function urlResolveObject(source, relative) {
            if (!source) return relative;
            return urlParse(source, false, true).resolveObject(relative)
        }
        Url.prototype.resolveObject = function (relative) {
            if (util.isString(relative)) {
                var rel = new Url;
                rel.parse(relative, false, true);
                relative = rel
            }
            var result = new Url;
            var tkeys = Object.keys(this);
            for (var tk = 0; tk < tkeys.length; tk++) {
                var tkey = tkeys[tk];
                result[tkey] = this[tkey]
            }
            result.hash = relative.hash;
            if (relative.href === "") {
                result.href = result.format();
                return result
            }
            if (relative.slashes && !relative.protocol) {
                var rkeys = Object.keys(relative);
                for (var rk = 0; rk < rkeys.length; rk++) {
                    var rkey = rkeys[rk];
                    if (rkey !== "protocol") result[rkey] = relative[rkey]
                }
                if (slashedProtocol[result.protocol] && result.hostname && !result.pathname) {
                    result.path = result.pathname = "/"
                }
                result.href = result.format();
                return result
            }
            if (relative.protocol && relative.protocol !== result.protocol) {
                if (!slashedProtocol[relative.protocol]) {
                    var keys = Object.keys(relative);
                    for (var v = 0; v < keys.length; v++) {
                        var k = keys[v];
                        result[k] = relative[k]
                    }
                    result.href = result.format();
                    return result
                }
                result.protocol = relative.protocol;
                if (!relative.host && !hostlessProtocol[relative.protocol]) {
                    var relPath = (relative.pathname || "").split("/");
                    while (relPath.length && !(relative.host = relPath.shift()));
                    if (!relative.host) relative.host = "";
                    if (!relative.hostname) relative.hostname = "";
                    if (relPath[0] !== "") relPath.unshift("");
                    if (relPath.length < 2) relPath.unshift("");
                    result.pathname = relPath.join("/")
                } else {
                    result.pathname = relative.pathname
                }
                result.search = relative.search;
                result.query = relative.query;
                result.host = relative.host || "";
                result.auth = relative.auth;
                result.hostname = relative.hostname || relative.host;
                result.port = relative.port;
                if (result.pathname || result.search) {
                    var p = result.pathname || "";
                    var s = result.search || "";
                    result.path = p + s
                }
                result.slashes = result.slashes || relative.slashes;
                result.href = result.format();
                return result
            }
            var isSourceAbs = result.pathname && result.pathname.charAt(0) === "/",
                isRelAbs = relative.host || relative.pathname && relative.pathname.charAt(0) === "/",
                mustEndAbs = isRelAbs || isSourceAbs || result.host && relative.pathname,
                removeAllDots = mustEndAbs,
                srcPath = result.pathname && result.pathname.split("/") || [],
                relPath = relative.pathname && relative.pathname.split("/") || [],
                psychotic = result.protocol && !slashedProtocol[result.protocol];
            if (psychotic) {
                result.hostname = "";
                result.port = null;
                if (result.host) {
                    if (srcPath[0] === "") srcPath[0] = result.host;
                    else srcPath.unshift(result.host)
                }
                result.host = "";
                if (relative.protocol) {
                    relative.hostname = null;
                    relative.port = null;
                    if (relative.host) {
                        if (relPath[0] === "") relPath[0] = relative.host;
                        else relPath.unshift(relative.host)
                    }
                    relative.host = null
                }
                mustEndAbs = mustEndAbs && (relPath[0] === "" || srcPath[0] === "")
            }
            if (isRelAbs) {
                result.host = relative.host || relative.host === "" ? relative.host : result.host;
                result.hostname = relative.hostname || relative.hostname === "" ? relative.hostname : result.hostname;
                result.search = relative.search;
                result.query = relative.query;
                srcPath = relPath
            } else if (relPath.length) {
                if (!srcPath) srcPath = [];
                srcPath.pop();
                srcPath = srcPath.concat(relPath);
                result.search = relative.search;
                result.query = relative.query
            } else if (!util.isNullOrUndefined(relative.search)) {
                if (psychotic) {
                    result.hostname = result.host = srcPath.shift();
                    var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
                    if (authInHost) {
                        result.auth = authInHost.shift();
                        result.host = result.hostname = authInHost.shift()
                    }
                }
                result.search = relative.search;
                result.query = relative.query;
                if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
                    result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "")
                }
                result.href = result.format();
                return result
            }
            if (!srcPath.length) {
                result.pathname = null;
                if (result.search) {
                    result.path = "/" + result.search
                } else {
                    result.path = null
                }
                result.href = result.format();
                return result
            }
            var last = srcPath.slice(-1)[0];
            var hasTrailingSlash = (result.host || relative.host || srcPath.length > 1) && (last === "." || last === "..") || last === "";
            var up = 0;
            for (var i = srcPath.length; i >= 0; i--) {
                last = srcPath[i];
                if (last === ".") {
                    srcPath.splice(i, 1)
                } else if (last === "..") {
                    srcPath.splice(i, 1);
                    up++
                } else if (up) {
                    srcPath.splice(i, 1);
                    up--
                }
            }
            if (!mustEndAbs && !removeAllDots) {
                for (; up--; up) {
                    srcPath.unshift("..")
                }
            }
            if (mustEndAbs && srcPath[0] !== "" && (!srcPath[0] || srcPath[0].charAt(0) !== "/")) {
                srcPath.unshift("")
            }
            if (hasTrailingSlash && srcPath.join("/").substr(-1) !== "/") {
                srcPath.push("")
            }
            var isAbsolute = srcPath[0] === "" || srcPath[0] && srcPath[0].charAt(0) === "/";
            if (psychotic) {
                result.hostname = result.host = isAbsolute ? "" : srcPath.length ? srcPath.shift() : "";
                var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
                if (authInHost) {
                    result.auth = authInHost.shift();
                    result.host = result.hostname = authInHost.shift()
                }
            }
            mustEndAbs = mustEndAbs || result.host && srcPath.length;
            if (mustEndAbs && !isAbsolute) {
                srcPath.unshift("")
            }
            if (!srcPath.length) {
                result.pathname = null;
                result.path = null
            } else {
                result.pathname = srcPath.join("/")
            }
            if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
                result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "")
            }
            result.auth = relative.auth || result.auth;
            result.slashes = result.slashes || relative.slashes;
            result.href = result.format();
            return result
        };
        Url.prototype.parseHost = function () {
            var host = this.host;
            var port = portPattern.exec(host);
            if (port) {
                port = port[0];
                if (port !== ":") {
                    this.port = port.substr(1)
                }
                host = host.substr(0, host.length - port.length)
            }
            if (host) this.hostname = host
        }
    }, {
        "./util": 75,
        punycode: 61,
        querystring: 64
    }],
    75: [function (require, module, exports) {
        "use strict";
        module.exports = {
            isString: function (arg) {
                return typeof arg === "string"
            },
            isObject: function (arg) {
                return typeof arg === "object" && arg !== null
            },
            isNull: function (arg) {
                return arg === null
            },
            isNullOrUndefined: function (arg) {
                return arg == null
            }
        }
    }, {}],
    76: [function (require, module, exports) {
        if (typeof Object.create === "function") {
            module.exports = function inherits(ctor, superCtor) {
                ctor.super_ = superCtor;
                ctor.prototype = Object.create(superCtor.prototype, {
                    constructor: {
                        value: ctor,
                        enumerable: false,
                        writable: true,
                        configurable: true
                    }
                })
            }
        } else {
            module.exports = function inherits(ctor, superCtor) {
                ctor.super_ = superCtor;
                var TempCtor = function () {};
                TempCtor.prototype = superCtor.prototype;
                ctor.prototype = new TempCtor;
                ctor.prototype.constructor = ctor
            }
        }
    }, {}],
    77: [function (require, module, exports) {
        module.exports = function isBuffer(arg) {
            return arg && typeof arg === "object" && typeof arg.copy === "function" && typeof arg.fill === "function" && typeof arg.readUInt8 === "function"
        }
    }, {}],
    78: [function (require, module, exports) {
        (function (process, global) {
            var formatRegExp = /%[sdj%]/g;
            exports.format = function (f) {
                if (!isString(f)) {
                    var objects = [];
                    for (var i = 0; i < arguments.length; i++) {
                        objects.push(inspect(arguments[i]))
                    }
                    return objects.join(" ")
                }
                var i = 1;
                var args = arguments;
                var len = args.length;
                var str = String(f).replace(formatRegExp, function (x) {
                    if (x === "%%") return "%";
                    if (i >= len) return x;
                    switch (x) {
                        case "%s":
                            return String(args[i++]);
                        case "%d":
                            return Number(args[i++]);
                        case "%j":
                            try {
                                return JSON.stringify(args[i++])
                            } catch (_) {
                                return "[Circular]"
                            }
                        default:
                            return x
                    }
                });
                for (var x = args[i]; i < len; x = args[++i]) {
                    if (isNull(x) || !isObject(x)) {
                        str += " " + x
                    } else {
                        str += " " + inspect(x)
                    }
                }
                return str
            };
            exports.deprecate = function (fn, msg) {
                if (isUndefined(global.process)) {
                    return function () {
                        return exports.deprecate(fn, msg).apply(this, arguments)
                    }
                }
                if (process.noDeprecation === true) {
                    return fn
                }
                var warned = false;

                function deprecated() {
                    if (!warned) {
                        if (process.throwDeprecation) {
                            throw new Error(msg)
                        } else if (process.traceDeprecation) {
                            console.trace(msg)
                        } else {
                            console.error(msg)
                        }
                        warned = true
                    }
                    return fn.apply(this, arguments)
                }
                return deprecated
            };
            var debugs = {};
            var debugEnviron;
            exports.debuglog = function (set) {
                if (isUndefined(debugEnviron)) debugEnviron = process.env.NODE_DEBUG || "";
                set = set.toUpperCase();
                if (!debugs[set]) {
                    if (new RegExp("\\b" + set + "\\b", "i").test(debugEnviron)) {
                        var pid = process.pid;
                        debugs[set] = function () {
                            var msg = exports.format.apply(exports, arguments);
                            console.error("%s %d: %s", set, pid, msg)
                        }
                    } else {
                        debugs[set] = function () {}
                    }
                }
                return debugs[set]
            };

            function inspect(obj, opts) {
                var ctx = {
                    seen: [],
                    stylize: stylizeNoColor
                };
                if (arguments.length >= 3) ctx.depth = arguments[2];
                if (arguments.length >= 4) ctx.colors = arguments[3];
                if (isBoolean(opts)) {
                    ctx.showHidden = opts
                } else if (opts) {
                    exports._extend(ctx, opts)
                }
                if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
                if (isUndefined(ctx.depth)) ctx.depth = 2;
                if (isUndefined(ctx.colors)) ctx.colors = false;
                if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
                if (ctx.colors) ctx.stylize = stylizeWithColor;
                return formatValue(ctx, obj, ctx.depth)
            }
            exports.inspect = inspect;
            inspect.colors = {
                bold: [1, 22],
                italic: [3, 23],
                underline: [4, 24],
                inverse: [7, 27],
                white: [37, 39],
                grey: [90, 39],
                black: [30, 39],
                blue: [34, 39],
                cyan: [36, 39],
                green: [32, 39],
                magenta: [35, 39],
                red: [31, 39],
                yellow: [33, 39]
            };
            inspect.styles = {
                special: "cyan",
                number: "yellow",
                boolean: "yellow",
                undefined: "grey",
                null: "bold",
                string: "green",
                date: "magenta",
                regexp: "red"
            };

            function stylizeWithColor(str, styleType) {
                var style = inspect.styles[styleType];
                if (style) {
                    return "[" + inspect.colors[style][0] + "m" + str + "[" + inspect.colors[style][1] + "m"
                } else {
                    return str
                }
            }

            function stylizeNoColor(str, styleType) {
                return str
            }

            function arrayToHash(array) {
                var hash = {};
                array.forEach(function (val, idx) {
                    hash[val] = true
                });
                return hash
            }

            function formatValue(ctx, value, recurseTimes) {
                if (ctx.customInspect && value && isFunction(value.inspect) && value.inspect !== exports.inspect && !(value.constructor && value.constructor.prototype === value)) {
                    var ret = value.inspect(recurseTimes, ctx);
                    if (!isString(ret)) {
                        ret = formatValue(ctx, ret, recurseTimes)
                    }
                    return ret
                }
                var primitive = formatPrimitive(ctx, value);
                if (primitive) {
                    return primitive
                }
                var keys = Object.keys(value);
                var visibleKeys = arrayToHash(keys);
                if (ctx.showHidden) {
                    keys = Object.getOwnPropertyNames(value)
                }
                if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0)) {
                    return formatError(value)
                }
                if (keys.length === 0) {
                    if (isFunction(value)) {
                        var name = value.name ? ": " + value.name : "";
                        return ctx.stylize("[Function" + name + "]", "special")
                    }
                    if (isRegExp(value)) {
                        return ctx.stylize(RegExp.prototype.toString.call(value), "regexp")
                    }
                    if (isDate(value)) {
                        return ctx.stylize(Date.prototype.toString.call(value), "date")
                    }
                    if (isError(value)) {
                        return formatError(value)
                    }
                }
                var base = "",
                    array = false,
                    braces = ["{", "}"];
                if (isArray(value)) {
                    array = true;
                    braces = ["[", "]"]
                }
                if (isFunction(value)) {
                    var n = value.name ? ": " + value.name : "";
                    base = " [Function" + n + "]"
                }
                if (isRegExp(value)) {
                    base = " " + RegExp.prototype.toString.call(value)
                }
                if (isDate(value)) {
                    base = " " + Date.prototype.toUTCString.call(value)
                }
                if (isError(value)) {
                    base = " " + formatError(value)
                }
                if (keys.length === 0 && (!array || value.length == 0)) {
                    return braces[0] + base + braces[1]
                }
                if (recurseTimes < 0) {
                    if (isRegExp(value)) {
                        return ctx.stylize(RegExp.prototype.toString.call(value), "regexp")
                    } else {
                        return ctx.stylize("[Object]", "special")
                    }
                }
                ctx.seen.push(value);
                var output;
                if (array) {
                    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys)
                } else {
                    output = keys.map(function (key) {
                        return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array)
                    })
                }
                ctx.seen.pop();
                return reduceToSingleString(output, base, braces)
            }

            function formatPrimitive(ctx, value) {
                if (isUndefined(value)) return ctx.stylize("undefined", "undefined");
                if (isString(value)) {
                    var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
                    return ctx.stylize(simple, "string")
                }
                if (isNumber(value)) return ctx.stylize("" + value, "number");
                if (isBoolean(value)) return ctx.stylize("" + value, "boolean");
                if (isNull(value)) return ctx.stylize("null", "null")
            }

            function formatError(value) {
                return "[" + Error.prototype.toString.call(value) + "]"
            }

            function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
                var output = [];
                for (var i = 0, l = value.length; i < l; ++i) {
                    if (hasOwnProperty(value, String(i))) {
                        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), true))
                    } else {
                        output.push("")
                    }
                }
                keys.forEach(function (key) {
                    if (!key.match(/^\d+$/)) {
                        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, true))
                    }
                });
                return output
            }

            function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
                var name, str, desc;
                desc = Object.getOwnPropertyDescriptor(value, key) || {
                    value: value[key]
                };
                if (desc.get) {
                    if (desc.set) {
                        str = ctx.stylize("[Getter/Setter]", "special")
                    } else {
                        str = ctx.stylize("[Getter]", "special")
                    }
                } else {
                    if (desc.set) {
                        str = ctx.stylize("[Setter]", "special")
                    }
                }
                if (!hasOwnProperty(visibleKeys, key)) {
                    name = "[" + key + "]"
                }
                if (!str) {
                    if (ctx.seen.indexOf(desc.value) < 0) {
                        if (isNull(recurseTimes)) {
                            str = formatValue(ctx, desc.value, null)
                        } else {
                            str = formatValue(ctx, desc.value, recurseTimes - 1)
                        }
                        if (str.indexOf("\n") > -1) {
                            if (array) {
                                str = str.split("\n").map(function (line) {
                                    return "  " + line
                                }).join("\n").substr(2)
                            } else {
                                str = "\n" + str.split("\n").map(function (line) {
                                    return "   " + line
                                }).join("\n")
                            }
                        }
                    } else {
                        str = ctx.stylize("[Circular]", "special")
                    }
                }
                if (isUndefined(name)) {
                    if (array && key.match(/^\d+$/)) {
                        return str
                    }
                    name = JSON.stringify("" + key);
                    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
                        name = name.substr(1, name.length - 2);
                        name = ctx.stylize(name, "name")
                    } else {
                        name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
                        name = ctx.stylize(name, "string")
                    }
                }
                return name + ": " + str
            }

            function reduceToSingleString(output, base, braces) {
                var numLinesEst = 0;
                var length = output.reduce(function (prev, cur) {
                    numLinesEst++;
                    if (cur.indexOf("\n") >= 0) numLinesEst++;
                    return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1
                }, 0);
                if (length > 60) {
                    return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1]
                }
                return braces[0] + base + " " + output.join(", ") + " " + braces[1]
            }

            function isArray(ar) {
                return Array.isArray(ar)
            }
            exports.isArray = isArray;

            function isBoolean(arg) {
                return typeof arg === "boolean"
            }
            exports.isBoolean = isBoolean;

            function isNull(arg) {
                return arg === null
            }
            exports.isNull = isNull;

            function isNullOrUndefined(arg) {
                return arg == null
            }
            exports.isNullOrUndefined = isNullOrUndefined;

            function isNumber(arg) {
                return typeof arg === "number"
            }
            exports.isNumber = isNumber;

            function isString(arg) {
                return typeof arg === "string"
            }
            exports.isString = isString;

            function isSymbol(arg) {
                return typeof arg === "symbol"
            }
            exports.isSymbol = isSymbol;

            function isUndefined(arg) {
                return arg === void 0
            }
            exports.isUndefined = isUndefined;

            function isRegExp(re) {
                return isObject(re) && objectToString(re) === "[object RegExp]"
            }
            exports.isRegExp = isRegExp;

            function isObject(arg) {
                return typeof arg === "object" && arg !== null
            }
            exports.isObject = isObject;

            function isDate(d) {
                return isObject(d) && objectToString(d) === "[object Date]"
            }
            exports.isDate = isDate;

            function isError(e) {
                return isObject(e) && (objectToString(e) === "[object Error]" || e instanceof Error)
            }
            exports.isError = isError;

            function isFunction(arg) {
                return typeof arg === "function"
            }
            exports.isFunction = isFunction;

            function isPrimitive(arg) {
                return arg === null || typeof arg === "boolean" || typeof arg === "number" || typeof arg === "string" || typeof arg === "symbol" || typeof arg === "undefined"
            }
            exports.isPrimitive = isPrimitive;
            exports.isBuffer = require("./support/isBuffer");

            function objectToString(o) {
                return Object.prototype.toString.call(o)
            }

            function pad(n) {
                return n < 10 ? "0" + n.toString(10) : n.toString(10)
            }
            var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            function timestamp() {
                var d = new Date;
                var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(":");
                return [d.getDate(), months[d.getMonth()], time].join(" ")
            }
            exports.log = function () {
                console.log("%s - %s", timestamp(), exports.format.apply(exports, arguments))
            };
            exports.inherits = require("inherits");
            exports._extend = function (origin, add) {
                if (!add || !isObject(add)) return origin;
                var keys = Object.keys(add);
                var i = keys.length;
                while (i--) {
                    origin[keys[i]] = add[keys[i]]
                }
                return origin
            };

            function hasOwnProperty(obj, prop) {
                return Object.prototype.hasOwnProperty.call(obj, prop)
            }
        }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
    }, {
        "./support/isBuffer": 77,
        _process: 60,
        inherits: 76
    }],
    79: [function (require, module, exports) {
        var TruffleError = require("truffle-error");
        var inherits = require("util").inherits;
        var web3 = require("web3");
        inherits(StatusError, TruffleError);
        var defaultGas = 9e4;

        function StatusError(args, tx, receipt) {
            var message;
            var gasLimit = parseInt(args.gas) || defaultGas;
            if (receipt.gasUsed === gasLimit) {
                message = "Transaction: " + tx + " exited with an error (status 0) after consuming all gas.\n" + "Please check that the transaction:\n" + "    - satisfies all conditions set by Solidity `assert` statements.\n" + "    - has enough gas to execute the full transaction.\n" + "    - does not trigger an invalid opcode by other means (ex: accessing an array out of bounds)."
            } else {
                message = "Transaction: " + tx + " exited with an error (status 0).\n" + "Please check that the transaction:\n" + "    - satisfies all conditions set by Solidity `require` statements.\n" + "    - does not trigger a Solidity `revert` statement.\n"
            }
            StatusError.super_.call(this, message);
            this.tx = tx;
            this.receipt = receipt
        }
        module.exports = StatusError
    }, {
        "truffle-error": 73,
        util: 78,
        web3: 45
    }]
}, {}, [2]);