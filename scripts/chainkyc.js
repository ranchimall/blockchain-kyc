
// Use instead of document.getElementById
const domRefs = {};
function getRef(elementId) {
    if (!domRefs.hasOwnProperty(elementId)) {
        domRefs[elementId] = {
            count: 1,
            ref: null,
        };
        return document.getElementById(elementId);
    } else {
        if (domRefs[elementId].count < 3) {
            domRefs[elementId].count = domRefs[elementId].count + 1;
            return document.getElementById(elementId);
        } else {
            if (!domRefs[elementId].ref)
                domRefs[elementId].ref = document.getElementById(elementId);
            return domRefs[elementId].ref;
        }
    }
}

class Router {
    constructor(options = {}) {
        const { routes = {}, state = {}, routingStart, routingEnd } = options
        this.routes = routes
        this.state = state
        this.routingStart = routingStart
        this.routingEnd = routingEnd
        window.addEventListener('hashchange', e => this.routeTo(window.location.hash))
    }
    addRoute(route, callback) {
        this.routes[route] = callback
    }
    async routeTo(path) {
        let page
        let wildcards = []
        let queryString
        let params
        [path, queryString] = path.split('?');
        if (path.includes('#'))
            path = path.split('#')[1];
        if (path.includes('/'))
            [, page, ...wildcards] = path.split('/')
        else
            page = path
        this.state = { page, wildcards }
        if (queryString) {
            params = new URLSearchParams(queryString)
            this.state.params = Object.fromEntries(params)
        }
        if (this.routingStart) {
            this.routingStart(this.state)
        }
        if (this.routes[page]) {
            await this.routes[page](this.state)
            this.state.lastPage = page
        } else {
            this.routes['404'](this.state)
        }
        if (this.routingEnd) {
            this.routingEnd(this.state)
        }
    }
}
const router = new Router({
    routingStart(state) {
        loading()
        if ("scrollRestoration" in history) {
            history.scrollRestoration = "manual";
        }
        window.scrollTo(0, 0);
    },
    routingEnd() {
        loading(false)
    }
})
function loading(show = true) {
    if (show) {
        getRef('loading').classList.remove('hidden')
    } else {
        getRef('loading').classList.add('hidden')
    }
}

floGlobals.approvedKycAggregators = {};
function getApprovedAggregators() {
    return new Promise((resolve, reject) => {
        floBlockchainAPI.readAllTxs(floGlobals.masterAddress).then(txs => {
            txs.filter(tx => tx.vin[0].addr === floGlobals.masterAddress && tx.floData.startsWith('KYC'))
                .reverse()
                .forEach(tx => {
                    const { floData, time } = tx;
                    const [service, operationType, operationData, validity] = floData.split('|');
                    switch (operationType) {
                        case 'APPROVE_AGGREGATOR':
                            operationData.split(',').forEach(aggregator => {
                                floGlobals.approvedKycAggregators[aggregator] = {
                                    validFrom: time * 1000,
                                    validTo: validity || Date.now() + 10000000
                                };
                            });
                            break;
                        case 'REVOKE_AGGREGATOR':
                            operationData.split(',').forEach(aggregator => {
                                floGlobals.approvedKycAggregators[aggregator].validTo = time * 1000;
                            });
                            break;
                        default:
                            break;
                    }
                });
            resolve();
        }).catch(e => {
            console.error(e);
            reject(e);
        })
    })
}