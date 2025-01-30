/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
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

import FactoryMaker from '../../core/FactoryMaker.js';
import Settings from '../../core/Settings.js';
import Constants from '../constants/Constants.js';
import Debug from '../../core/Debug.js';

const MIN_PROGRESS_ELAPSED_TIME_MS = 100;
const MIN_PROGRESS_SIZE_BYTES = 16e3;

/**
 * @module FetchProgressHandler
 * @ignore
 * @description Handles data download progress of HTTP requests.
 */
function FetchProgressHandler() {

    const context = this.context;
    const settings = Settings(context).getInstance();
    let instance,
        logger,
        requestConfig,
        loaded,
        lastProgressTime;

    function setConfig(cfg) {
    }

    function setup() {
        logger = Debug(context).getInstance().getLogger(instance);
    }

    function initialize(config, fetchLoader) {
        requestConfig = config;
        loaded = 0;
        lastProgressTime = Date.now();
        fetchLoader.addListener({
            onheaders: onHeaders,
            onprogress: onProgress
        });
    }

    function onHeaders(cmResponse) {
        console.log(cmResponse);
        // Intialize timing and size infos to check progress
        requestConfig.request.firstByteDate = new Date();
        requestConfig.request.bytesTotal = Number(cmResponse.headers['content-length']);
    }

    function onProgress(cmResponse, progress) {
        // console.log(progress);
        if (!requestConfig || !requestConfig.progress) {
            return;
        }

        const currentTime = Date.now();
        const chunkSize = progress.loaded - loaded;
        const elapsedTime = currentTime - lastProgressTime;

        // Notifies progress only if enough time and enough amount of data has been received, or at end of download
        if ((elapsedTime > MIN_PROGRESS_ELAPSED_TIME_MS && chunkSize >= MIN_PROGRESS_SIZE_BYTES) ||
            progress.loaded === progress.total) {
            
            loaded = progress.loaded;
            lastProgressTime = currentTime;

            // Update input request progress information (especially to used to check if request should be abandonned)
            requestConfig.request.bytesLoaded = progress.loaded;
            requestConfig.request.bytesTotal = progress.total;    

            // Add trace
            if (!requestConfig.request.traces) {
                requestConfig.request.traces = [];
            }
            requestConfig.request.traces.push({
                s: new Date(lastProgressTime),
                d: elapsedTime,
                b: loaded
            });


            // Do not set data property on base progress event to avoid appending invalid data
            // (only complete chunks must be appended in low latency/chunked transfer encoding mode)
            const progressEvent = {
                loaded: progress.loaded,
                total: progress.total,
                timestamp: progress.timestamp
            }

            requestConfig.progress(progressEvent);
        }
    }

    setup();

    instance = {
        initialize,
        setConfig,
    };

    return instance;

}

FetchProgressHandler.__dashjs_factory_name = 'FetchProgressHandler';

const factory = FactoryMaker.getClassFactory(FetchProgressHandler);
export default factory;

