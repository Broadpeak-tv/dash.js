/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2023, Broadpeak, S.A.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
import EventBus from '../../core/EventBus';
import MediaPlayerEvents from '../MediaPlayerEvents';
import FactoryMaker from '../../core/FactoryMaker';
import Settings from '../../core/Settings';
import Constants from '../constants/Constants';
import MetricsConstants from '../constants/MetricsConstants';
import {HTTPRequest} from '../vo/metrics/HTTPRequest';
import {
    replaceIDForTemplate,
    replaceTokenForTemplate,
    unescapeDollarsInTemplate
} from '../../dash/utils/SegmentsUtils';

const VERSION = '1.0';
const KEY_PREFIX = 'tv.broadpeak.s4s-';
const KEY_VERSION = KEY_PREFIX + 'version';
const KEY_MODE = KEY_PREFIX + 'mode';
const KEY_CONTEXT = KEY_PREFIX + 'context';
const KEY_MEDIA = KEY_PREFIX + 'media';
const KEY_BITRATE = KEY_PREFIX + 'bitrate';
const LOCAL_STORAGE_KEY = 's4s';

const S4S_MODES = {
    TRANSPARENT: 'T',
    SERVER_DRIVEN: 'S',
    SERVER_ASSISTED: 'C'
}

function S4SModel() {

    let instance,
        cmcdModel,
        baseURLController,
        streamController,
        abrController,
        urlUtils,
        _mode;

    let context = this.context;
    let eventBus = EventBus(context).getInstance();
    let settings = Settings(context).getInstance();

    function setup() {
        _resetInitialSettings();
    }

    function initialize() {
        eventBus.on(MediaPlayerEvents.METRIC_ADDED, _onMetricAdded, instance);
    }

    function setConfig(config) {
        if (!config) return;

        if (config.cmcdModel) {
            cmcdModel = config.cmcdModel;
            cmcdModel.addCustomCmcdProvider(this);
        }

        if (config.baseURLController) {
            baseURLController = config.baseURLController;
        }

        if (config.streamController) {
            streamController = config.streamController;
        }

        if (config.abrController) {
            abrController = config.abrController;
        }

        if (config.urlUtils) {
            urlUtils = config.urlUtils;
        }
    }

    function _resetInitialSettings() {
        _mode = S4S_MODES.TRANSPARENT;
    }

    function _resolveUrl(destination, representation) {
        const baseURL = baseURLController.resolve(representation.path);
        let url;

        if (!baseURL || (destination === baseURL.url) || (!urlUtils.isRelative(destination))) {
            url = destination;
        } else {
            url = baseURL.url;

            if (destination) {
                url = urlUtils.resolve(destination, url);
            }
        }

        if (urlUtils.isRelative(url)) {
            return null;
        }

        return url;
    }

    function _getContext(request) {
        let context = null;
        try {
            const obj = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)) || {};
            const fqdn = new URL(request.url).hostname;
            context = obj[fqdn];    
        } catch (e) {
            return null;
        }
        return context;
    }

    function _storeContext(request, context) {
        // Store context only in non-transparent mode
        if (settings.get().streaming.s4s && settings.get().streaming.s4s.requestMode === S4S_MODES.TRANSPARENT) {
            return;
        }

        try {
            const obj = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)) || {};
            const fqdn = new URL(request.url).hostname;
            obj[fqdn] = context;
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(obj));
        } catch (e) {
            return null;
        }
    }

    function _getBackgroundBitrate() {
        // Consider only audio track
        try {
            const stream = streamController.getActiveStream();
            const bitrateList = stream.getBitrateListFor(Constants.AUDIO);
            const quality = abrController.getQualityFor(Constants.AUDIO);
            return bitrateList[quality].bitrate;
        }
        catch (e) {
            return 0;
        }
    }

    function _getMediaRepresentations(segment) {
        let medias = [];

        const backgroundBitrate = _getBackgroundBitrate();

        for (let streamProcessor of streamController.getActiveStreamProcessors()) {
            const representationController = streamProcessor.getRepresentationController();
            let representation = null;

            for (let i = 0; representation = representationController.getRepresentationForQuality(i); i++) {
                if (representation.adaptation.type !== Constants.VIDEO) {
                    continue;
                }

                // Build template urls as done in DashHandler.js
                let url = representation.media;
                url = replaceTokenForTemplate(url, 'Number', segment.replacementNumber);
                url = replaceTokenForTemplate(url, 'Time', segment.replacementTime);
                url = replaceTokenForTemplate(url, 'Bandwidth', representation.bandwidth);
                url = replaceIDForTemplate(url, representation.id);
                url = unescapeDollarsInTemplate(url);
                url = _resolveUrl(url, representation);
                url = new URL(url).pathname;

                let initUrl = representation.initialization;
                initUrl = replaceTokenForTemplate(initUrl, 'Bandwidth', representation.bandwidth);
                initUrl = unescapeDollarsInTemplate(initUrl);
                initUrl = _resolveUrl(initUrl, representation);
                initUrl = new URL(initUrl).pathname;

                let background_bitrate = backgroundBitrate;

                medias.push('"' + url.replace('"', '\\"') + '"'
                    + ';bitrate=' + representation.bandwidth
                    + ';background=' + background_bitrate
                    + ';init="' + initUrl.replace('"', '\\"') + '"');
            }
        }

        return medias.join();
    }

    function _setCurrentQuality(bitrate) {
        const stream = streamController.getActiveStream();
        const streamInfo = stream.getStreamInfo();
        const bitrateList = stream.getBitrateListFor(Constants.VIDEO);
        const quality = abrController.getQualityFor(Constants.VIDEO);

        if (bitrate === bitrateList[quality].bitrate) {
            return;
        }

        // Get new quality corresponding to returned bitrate
        const newQuality = bitrateList.findIndex(b => b.bitrate === bitrate);
        if (newQuality === -1) {
            return;
        }
        abrController.setPlaybackQuality(Constants.VIDEO, streamInfo, newQuality);
    }

    function _onMetricAdded(e) {
        if (e.metric !== MetricsConstants.HTTP_REQUEST) {
            return;
        }
        if (e.mediaType !== Constants.VIDEO) {
            return;
        }
        const request = e.value;
        const cmsd = request.cmsd;
        if (!cmsd) {
            return;
        }

        if (cmsd.static) {
            // Get S4S mode
            const mode = cmsd.static[KEY_MODE];
            if (mode) {
                _mode = mode;
            }
        }

        if (cmsd.dynamic) {
            // Get context
            const context = cmsd.dynamic[KEY_CONTEXT];
            if (context) {
                _storeContext(request, context);
            } 
            // Get returned media bitrate and apply quality change (only in server driven mode)
            if (_mode === S4S_MODES.SERVER_DRIVEN) {
                const bitrate = cmsd.dynamic[KEY_BITRATE];
                if (bitrate) {
                    _setCurrentQuality(bitrate)
                }    
            }
        }
    }

    function getCmcdSessionHeaderKeys() {
        return [
            KEY_VERSION
        ];
    }

    function getCmcdObjectHeaderKeys() {
        return [];
    }

    function getCmcdRequestHeaderKeys() {
        return [
            KEY_MEDIA
        ];
    }

    function getCmcdStatusHeaderKeys() {
        return [];
    }

    function getCmcdDdata(request) {
        if (!settings.get().streaming.s4s || !settings.get().streaming.s4s.enabled) {
            return {};
        }

        const cmcdData = {};

        // Add S4S version
        cmcdData[KEY_VERSION] = VERSION;

        if (request.type === HTTPRequest.MEDIA_SEGMENT_TYPE) {
            const context = _getContext(request);
            if (context) {
                cmcdData[KEY_CONTEXT] = context;
            }
            if (_mode !== S4S_MODES.TRANSPARENT) {
                cmcdData[KEY_MEDIA] = _getMediaRepresentations(request);
            }
        }

        return cmcdData;
    }

    function reset() {
        eventBus.off(MediaPlayerEvents.METRIC_ADDED, _onMetricAdded, instance);
        _resetInitialSettings();
    }

    instance = {
        getCmcdDdata,
        getCmcdSessionHeaderKeys,
        getCmcdObjectHeaderKeys,
        getCmcdRequestHeaderKeys,
        getCmcdStatusHeaderKeys,
        setConfig,
        reset,
        initialize
    };

    setup();

    return instance;
}

S4SModel.__dashjs_factory_name = 'S4SModel';
export default FactoryMaker.getSingletonFactory(S4SModel);
