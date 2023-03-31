
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
let zIndex = 50
// function required for popups or modals to appear
function openPopup(popupId, pinned) {
    zIndex++
    getRef(popupId).setAttribute('style', `z-index: ${zIndex}`)
    return getRef(popupId).show({ pinned })
}

// hides the popup or modal
function closePopup(options = {}) {
    if (popupStack.peek() === undefined)
        return;
    popupStack.peek().popup.hide(options)
}
// displays a popup for asking permission. Use this instead of JS confirm
const getConfirmation = (title, options = {}) => {
    return new Promise(resolve => {
        const { message = '', cancelText = 'Cancel', confirmText = 'OK', danger = false } = options
        getRef('confirm_title').innerText = title;
        getRef('confirm_message').innerText = message;
        const cancelButton = getRef('confirmation_popup').querySelector('.cancel-button');
        const confirmButton = getRef('confirmation_popup').querySelector('.confirm-button')
        confirmButton.textContent = confirmText
        cancelButton.textContent = cancelText
        if (danger)
            confirmButton.classList.add('button--danger')
        else
            confirmButton.classList.remove('button--danger')
        const { closed } = openPopup('confirmation_popup')
        confirmButton.onclick = () => {
            closePopup({ payload: true })
        }
        cancelButton.onclick = () => {
            closePopup()
        }
        closed.then((payload) => {
            confirmButton.onclick = null
            cancelButton.onclick = null
            if (payload)
                resolve(true)
            else
                resolve(false)
        })
    })
}
// Use when a function needs to be executed after user finishes changes
const debounce = (callback, wait) => {
    let timeoutId = null;
    return (...args) => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
            callback.apply(null, args);
        }, wait);
    };
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

function getApprovedAggregators() {
    floGlobals.approvedKycAggregators = {};
    return new Promise((resolve, reject) => {
        floBlockchainAPI.readAllTxs(floGlobals.masterAddress).then(txs => {
            txs.filter(tx => floCrypto.isSameAddr(tx.vin[0].addr, floGlobals.masterAddress) && tx.floData.startsWith('KYC'))
                .reverse()
                .forEach(tx => {
                    const { floData, time } = tx;
                    const [service, operationType, operationData, validity] = floData.split('|');
                    switch (operationType) {
                        case 'APPROVE_AGGREGATOR':
                            operationData.split(',').forEach(aggregator => {
                                floGlobals.approvedKycAggregators[floCrypto.toFloID(aggregator)] = {
                                    validFrom: time * 1000,
                                    validTo: validity || Date.now() + 10000000
                                };
                            });
                            break;
                        case 'REVOKE_AGGREGATOR':
                            operationData.split(',').forEach(aggregator => {
                                floGlobals.approvedKycAggregators[floCrypto.toFloID(aggregator)].validTo = time * 1000;
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

function getApprovedKycs() {
    floGlobals.approvedKyc = {};
    return new Promise((resolve, reject) => {
        const aggregatorTxs = Object.keys(floGlobals.approvedKycAggregators).map(aggregator => {
            return floBlockchainAPI.readAllTxs(aggregator);
        });
        Promise.all(aggregatorTxs).then(aggregatorData => {
            aggregatorData = aggregatorData.flat(1)
                .filter(tx => tx.vin[0].addr in floGlobals.approvedKycAggregators && tx.floData.startsWith('KYC'))
                .sort((a, b) => a.time - b.time);
            for (const tx of aggregatorData) {
                const { floData, time, vin, vout } = tx;
                const [service, operationType, operationData, validity] = floData.split('|');
                switch (operationType) {
                    case 'APPROVE_KYC':
                        operationData.split(',').forEach(address => {
                            floGlobals.approvedKyc[address] = {
                                validFrom: time * 1000,
                                validTo: validity || Date.now() + 10000000,
                                verifiedBy: vin[0].addr
                            };
                        });
                        break;
                    case 'REVOKE_KYC':
                        operationData.split(',').forEach(address => {
                            floGlobals.approvedKyc[address].validTo = time * 1000;
                            floGlobals.approvedKyc[address].revokedBy = vin[0].addr;
                        });
                        break;
                    default:
                        return;
                }
            }
            resolve();
        }).catch(e => {
            reject(e);
        })
    })
}