class CommonMediaResponse {
    /**
     * @param {Object} params
     * @param {CommonMediaRequest} params.request
     * @param {string} [params.url]
     * @param {boolean} [params.redirected]
     * @param {boolean} [params.aborted]
     * @param {string} [params.abortReason]
     * @param {number} [params.status]
     * @param {string} [params.statusText]
     * @param {Object<string, string>} [params.headers]
     * @param {any} [params.data]
     * @param {ResourceTiming} [params.resourceTiming]
     */
    constructor(params) {
        this.request = params.request;
        this.url = params.url !== undefined ? params.url : null;
        this.redirected = params.redirected !== undefined ? params.redirected : false;
        this.aborted = params.aborted !== undefined ? params.aborted : false;
        this.abortReason = params.abortReason !== undefined ? params.abortReason : null;
        this.status = params.status !== undefined ? params.status : null;
        this.statusText = params.statusText !== undefined ? params.statusText : '';
        this.headers = params.headers !== undefined ? params.headers : {};
        this.data = params.data !== undefined ? params.data : null;
        this.resourceTiming = params.resourceTiming !== undefined ? params.resourceTiming : null;
    }
}

export default CommonMediaResponse;
