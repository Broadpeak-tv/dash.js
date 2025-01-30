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
import {HTTPRequest} from '../vo/metrics/HTTPRequest.js';
import FetchProgressHandler from './FetchProgressHandler.js';
import FactoryMaker from '../../core/FactoryMaker.js';
import DashJSError from '../vo/DashJSError.js';
import CmcdModel from '../models/CmcdModel.js';
import CmsdModel from '../models/CmsdModel.js';
import Utils from '../../core/Utils.js';
import Debug from '../../core/Debug.js';
import EventBus from '../../core/EventBus.js';
import Events from '../../core/events/Events.js';
import Settings from '../../core/Settings.js';
import Constants from '../constants/Constants.js';
import CustomParametersModel from '../models/CustomParametersModel.js';
import CommonAccessTokenController from '../controllers/CommonAccessTokenController.js';
import ClientDataReportingController from '../controllers/ClientDataReportingController.js';
import ExtUrlQueryInfoController from '../controllers/ExtUrlQueryInfoController.js';
import CommonMediaRequest from '../vo/CommonMediaRequest.js';
import CommonMediaResponse from '../vo/CommonMediaResponse.js';
import {FetchLoader} from '@svta/common-media-library/request/FetchLoader.js';

/**
 * @module HTTPLoader
 * @ignore
 * @description Manages download of resources via HTTP.
 * @param {Object} cfg - dependencies from parent
 */
function HTTPLoader(cfg) {

    cfg = cfg || {};

    const context = this.context;
    const errHandler = cfg.errHandler;
    const dashMetrics = cfg.dashMetrics;
    const mediaPlayerModel = cfg.mediaPlayerModel;
    const boxParser = cfg.boxParser;
    const errors = cfg.errors;
    const requestTimeout = cfg.requestTimeout || 0;
    const eventBus = EventBus(context).getInstance();
    const settings = Settings(context).getInstance();

    let instance,
        pendingRequests,
        downloadErrorToRequestTypeMap,
        cmcdModel,
        cmsdModel,
        customParametersModel,
        commonAccessTokenController,
        clientDataReportingController,
        extUrlQueryInfoController,
        logger;

    function setup() {
        logger = Debug(context).getInstance().getLogger(instance);
        pendingRequests = [];
        cmcdModel = CmcdModel(context).getInstance();
        clientDataReportingController = ClientDataReportingController(context).getInstance();
        cmsdModel = CmsdModel(context).getInstance();
        customParametersModel = CustomParametersModel(context).getInstance();
        commonAccessTokenController = CommonAccessTokenController(context).getInstance();
        extUrlQueryInfoController = ExtUrlQueryInfoController(context).getInstance();

        downloadErrorToRequestTypeMap = {
            [HTTPRequest.MPD_TYPE]: errors.DOWNLOAD_ERROR_ID_MANIFEST_CODE,
            [HTTPRequest.XLINK_EXPANSION_TYPE]: errors.DOWNLOAD_ERROR_ID_XLINK_CODE,
            [HTTPRequest.INIT_SEGMENT_TYPE]: errors.DOWNLOAD_ERROR_ID_INITIALIZATION_CODE,
            [HTTPRequest.MEDIA_SEGMENT_TYPE]: errors.DOWNLOAD_ERROR_ID_CONTENT_CODE,
            [HTTPRequest.INDEX_SEGMENT_TYPE]: errors.DOWNLOAD_ERROR_ID_CONTENT_CODE,
            [HTTPRequest.BITSTREAM_SWITCHING_SEGMENT_TYPE]: errors.DOWNLOAD_ERROR_ID_CONTENT_CODE,
            [HTTPRequest.OTHER_TYPE]: errors.DOWNLOAD_ERROR_ID_CONTENT_CODE
        };
    }

    function setConfig(config) {
        if (!config) {
            return;
        }

        if (config.commonAccessTokenController) {
            commonAccessTokenController = config.commonAccessTokenController
        }

        if (config.extUrlQueryInfoController) {
            extUrlQueryInfoController = config.extUrlQueryInfoController;
        }
    }

    /**
     * Initiates a download of the resource described by config.request.
     * @param {Object} config - contains request (FragmentRequest or derived type), and callbacks
     * @memberof module:HTTPLoader
     * @instance
     */
    function load(config) {
        if (config.request) {
            const retryAttempts = mediaPlayerModel.getRetryAttemptsForType(config.request.type);
            config.remainingAttempts = retryAttempts;
            return _internalLoad(config);
        } else {
            if (config.error) {
                config.error(config.request, 'error');
            }
            return Promise.resolve();
        }
    }

    /**
     * Aborts any inflight downloads
     * @memberof module:HTTPLoader
     * @instance
     */
    function abort() {

        pendingRequests.forEach(r => {
            // Cancel delayed requests
            if (r.timeoutId) {
                clearTimeout(r.timeoutId);
            }

            const config = r.config;
            const request = config.request;
            // Notify request is aborted for retried requests in order to trigger LOADING_ABANDONED event
            if (r.retry) {
                if (request && config.abort) {
                    config.abort(request);
                }
            }

            // MSS patch: do not abort FragmentInfo requests
            if (request && request.type === HTTPRequest.MSS_FRAGMENT_INFO_SEGMENT_TYPE) {
                return;
            }

            if (r.fetchLoader) {
                // Abort on-going requests but unregister handlers to ignore aborted requests
                request.success = request.complete = request.error = request.abort = undefined;
                r.fetchLoader.abort();
            }
        });
    }

    function resetInitialSettings() {
    }

    function reset() {
        abort();
        pendingRequests = [];
    }

    /**
     * Initiates or re-initiates a download of the resource
     * @param {object} config
     * @private
     */
    function _internalLoad(config) {

        const request = config.request;
     
        // Adds the ability to delay single fragment loading time to control buffer.
        let now = new Date().getTime();
        if (!isNaN(request.delayLoadingTime) && now < request.delayLoadingTime) {
            const delay = request.delayLoadingTime - now;
            _pendRequest(config, delay);
            return;
        }
        
        // Set request headers
        request.headers = {};
        _updateRequestUrlAndHeaders(request);
        if (request.range) {
            request.headers['Range'] = 'bytes=' + request.range;
        }

        // Create CommonMediaRequest
        let commonMediaRequest = _commonMediaRequest(request);

        _applyRequestInterceptors(commonMediaRequest).then((_commonMediaRequest) => {
            commonMediaRequest = _commonMediaRequest;

            const fetchLoader = new FetchLoader();

            const progressHandler = _setProgressHandler(config, fetchLoader);

            pendingRequests.push({
                config,
                fetchLoader,
                progressHandler
            })

            request.startDate = new Date();
            fetchLoader.load(commonMediaRequest).then((response => {

                _removePendingRequest(config);

                // response as CommonMediaResponse
                let commonMediaResponse = _commonMediaResponse(response);

                commonAccessTokenController.processResponseHeaders(commonMediaResponse);

                _applyResponseInterceptors(commonMediaResponse).then((_commonMediaResponse) => {
                    commonMediaResponse = _commonMediaResponse;
    
                    _updateRequestTimingInfo(request, commonMediaResponse);
                    _addHttpRequestMetric(request, commonMediaResponse, request.traces);

                    _processReponse(config, commonMediaResponse);
                });
            }));
        });

    }

    function _pendRequest(config, delay, retry = false) {
        const pendingRequest = {
            config,
            retry
        };
        pendingRequests.push(pendingRequest);
        pendingRequest.timeoutId = setTimeout(() => {
            _removePendingRequest(pendingRequest.config);
            _internalLoad(pendingRequest.config);
            // try {
            //     _internalLoad(loader, delayedRequest.httpRequest, delayedRequest.httpResponse);
            // } catch (e) {
            //     delayedRequest.httpRequest.onloadend();
            // }
        }, delay);
    }

    function _commonMediaRequest(request) {
        const withCredentials = customParametersModel.getXHRWithCredentialsForType(request.type);
        return new CommonMediaRequest({
            url: request.url,
            method: HTTPRequest.GET,
            responseType: request.responseType,
            headers: request.headers,
            credentials: withCredentials ? 'include' : 'omit',
            timeout: requestTimeout,
            cmcd: cmcdModel.getCmcdData(request),
            customData: { request }
        });
    }

    function _commonMediaResponse(response) {
        return new CommonMediaResponse({
            request: response.request,
            url: response.url,
            redirected: response.redirected,
            aborted: response.aborted,
            abortReason: response.abortReason,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data,
            resourceTiming: response.resourceTiming
        });
    }

    function _applyRequestInterceptors(httpRequest) {
        const interceptors = customParametersModel.getRequestInterceptors();
        if (!interceptors) {
            return Promise.resolve(httpRequest);
        }

        return interceptors.reduce((prev, next) => {
            return prev.then((request) => {
                return next(request);
            });
        }, Promise.resolve(httpRequest));
    }

    function _applyResponseInterceptors(response) {
        const interceptors = customParametersModel.getResponseInterceptors();
        if (!interceptors) {
            return Promise.resolve(response);
        }

        return interceptors.reduce((prev, next) => {
            return prev.then(resp => {
                return next(resp);
            });
        }, Promise.resolve(response));
    }

    function _setProgressHandler(config, fetchLoader) {
        // Handle and notify download progress only for media segments
        if (config.request.type !== HTTPRequest.MEDIA_SEGMENT_TYPE) {
            return;
        }
        const fetchProgressHandler = FetchProgressHandler(context).create();
        fetchProgressHandler.initialize(config, fetchLoader);
    }

    function _updateRequestTimingInfo(request, commonMediaResponse) {
        const responseStartDelta = commonMediaResponse.resourceTiming.responseStart - commonMediaResponse.resourceTiming.startTime;
        request.firstByteDate = new Date(request.startDate.getTime() + responseStartDelta);
        request.endDate = new Date(request.startDate.getTime() + commonMediaResponse.resourceTiming.duration);

        if (!request.traces) {
            request.traces = [{
                s: commonMediaResponse.resourceTiming.responseStart,
                d: commonMediaResponse.resourceTiming.duration,
                b: [commonMediaResponse.resourceTiming.encodedBodySize],
                t: undefined
            }];
        }

        request.bytesLoaded = commonMediaResponse.resourceTiming.encodedBodySize;
        request.bytesTotal = commonMediaResponse.resourceTiming.encodedBodySize;
    }

    function _addHttpRequestMetric(request, commonMediaResponse, traces) {
        const cmsd = settings.get().streaming.cmsd && settings.get().streaming.cmsd.enabled ? cmsdModel.parseResponseHeaders(commonMediaResponse.headers, request.mediaType) : null;
        dashMetrics.addHttpRequest(request, commonMediaResponse.url, commonMediaResponse.status, commonMediaResponse.headers, traces, cmsd);
    }

    function _processReponse(config, commonMediaResponse) {

        const request = config.request;

        // Aborted request
        if (commonMediaResponse.aborted) {
            if (commonMediaResponse.abortReason === 'user' && config.abort) {
                config.abort(request);
            }
            if (commonMediaResponse.abortReason === 'timeout') {
                timeoutMessage = 'Request timeout: non-computable download size';
                logger.warn(timeoutMessage);
                _completeOnError(config, commonMediaResponse);
            }
            return;
        }

        // Trigger manifest loaded event
        if (request.type === HTTPRequest.MPD_TYPE) {
            dashMetrics.addManifestUpdate(request);
            eventBus.trigger(Events.MANIFEST_LOADING_FINISHED, { request });
        }

        // Request on error
        if (commonMediaResponse.status < 200 || commonMediaResponse.status > 299 || !commonMediaResponse.data) {
            // Trigger UTC sync for manifest requests
            _triggerUtcSync(config, commonMediaResponse);

            if (config.remainingAttempts > 0) {
                // Retry request
                config.remainingAttempts--;
                const delay = mediaPlayerModel.getRetryIntervalsForType(request.type)
                _pendRequest(config, delay, true);
            } else {
                _completeOnError(config, commonMediaResponse);
            }
        } else {
            _completeOnSuccess(config, commonMediaResponse);
        }
    }

    function _triggerUtcSync (config, commonMediaResponse) {
        // If we get a 404 to a media segment we should check the client clock again and perform a UTC sync in the background.
        try {
            if (commonMediaResponse.status === 404 &&
                settings.get().streaming.utcSynchronization.enableBackgroundSyncAfterSegmentDownloadError &&
                config.request.type === HTTPRequest.MEDIA_SEGMENT_TYPE) {
                // Only trigger a sync if the loading failed for the first time
                const initialNumberOfAttempts = mediaPlayerModel.getRetryAttemptsForType(HTTPRequest.MEDIA_SEGMENT_TYPE);
                if (initialNumberOfAttempts === config.remainingAttempts) {
                    eventBus.trigger(Events.ATTEMPT_BACKGROUND_SYNC);
                }
            }
        } catch (e) {
        }
        
    }

    function _completeOnSuccess(config, commonMediaResponse) {

        if (config.success) {
            config.success(commonMediaResponse.data, commonMediaResponse.statusText, commonMediaResponse.url);
        }

        if (config.complete) {
            config.complete(config.request, commonMediaResponse.statusText);
        }
    }

    function _completeOnError(config, commonMediaResponse) {
        const request = config.request;
        if (request.type === HTTPRequest.MSS_FRAGMENT_INFO_SEGMENT_TYPE) {
            return;
        }

        errHandler.error(new DashJSError(downloadErrorToRequestTypeMap[request.type], request.url + ' is not available', {
            request,
            response: commonMediaResponse
        }));

        if (config.error) {
            config.error(request, 'error', commonMediaResponse.statusText, commonMediaResponse);
        }

        if (config.complete) {
            config.complete(request, commonMediaResponse.statusText);
        }
    }

    /**
     * Updates the request url and headers according to CMCD and content steering (pathway cloning)
     * @param request
     * @private
     */
    function _updateRequestUrlAndHeaders(request) {
        _updateRequestUrlAndHeadersWithCmcd(request);
        _addExtUrlQueryParameters(request);
        _addPathwayCloningParameters(request);
        _addCommonAccessToken(request);
    }

    function _addExtUrlQueryParameters(request) {
        // Add ExtUrlQueryInfo parameters
        let finalQueryString = extUrlQueryInfoController.getFinalQueryString(request);
        if (finalQueryString) {
            request.url = Utils.addAdditionalQueryParameterToUrl(request.url, finalQueryString);
        }
    }

    function _addPathwayCloningParameters(request) {
        // Add queryParams that came from pathway cloning
        if (request.queryParams) {
            const queryParams = Object.keys(request.queryParams).map((key) => {
                return {
                    key,
                    value: request.queryParams[key]
                }
            })
            request.url = Utils.addAdditionalQueryParameterToUrl(request.url, queryParams);
        }
    }

    function _addCommonAccessToken(request) {
        const commonAccessToken = commonAccessTokenController.getCommonAccessTokenForUrl(request.url)
        if (commonAccessToken) {
            request.headers[Constants.COMMON_ACCESS_TOKEN_HEADER] = commonAccessToken
        }
    }

    /**
     * Updates the request url and headers with CMCD data
     * @param request
     * @private
     */
    function _updateRequestUrlAndHeadersWithCmcd(request) {
        const currentServiceLocation = request?.serviceLocation;
        const currentAdaptationSetId = request?.mediaInfo?.id?.toString();
        const isIncludedFilters = clientDataReportingController.isServiceLocationIncluded(request.type, currentServiceLocation) &&
            clientDataReportingController.isAdaptationsIncluded(currentAdaptationSetId);
        if (isIncludedFilters && cmcdModel.isCmcdEnabled()) {
            const cmcdParameters = cmcdModel.getCmcdParametersFromManifest();
            const cmcdMode = cmcdParameters.mode ? cmcdParameters.mode : settings.get().streaming.cmcd.mode;
            if (cmcdMode === Constants.CMCD_MODE_QUERY) {
                const additionalQueryParameter = _getAdditionalQueryParameter(request);
                request.url = Utils.addAdditionalQueryParameterToUrl(request.url, additionalQueryParameter);
            } else if (cmcdMode === Constants.CMCD_MODE_HEADER) {
                request.headers = Object.assign(request.headers, cmcdModel.getHeaderParameters(request));
            }
        }
    }

    /**
     * Generates the additional query parameters to be appended to the request url
     * @param {object} request
     * @return {array}
     * @private
     */
    function _getAdditionalQueryParameter(request) {
        try {
            const additionalQueryParameter = [];
            const cmcdQueryParameter = cmcdModel.getQueryParameter(request);

            if (cmcdQueryParameter) {
                additionalQueryParameter.push(cmcdQueryParameter);
            }

            return additionalQueryParameter;
        } catch (e) {
            return [];
        }
    }

    function _removePendingRequest(config) {
        const index = pendingRequests.findIndex(r => r.config.request.url === config.request.url);
        if (index >= 0) {
            pendingRequests.splice(index, 1);
        }
    }

    instance = {
        abort,
        load,
        reset,
        resetInitialSettings,
        setConfig,
    };

    setup();

    return instance;
}

HTTPLoader.__dashjs_factory_name = 'HTTPLoader';

const factory = FactoryMaker.getClassFactory(HTTPLoader);
export default factory;
