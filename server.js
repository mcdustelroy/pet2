const express = require('express');
require('dotenv').config()
const app = express();
const axios = require('axios');
const http = require('http');
const server = http.createServer(app);
var bodyParser = require('body-parser')
var jsonParser = bodyParser.json()
var urlencodedParser = bodyParser.urlencoded({ extended: false })
const fetch = (...args) =>
	import('node-fetch').then(({default: fetch}) => fetch(...args));
app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  }),
);  

let accountType 

const credentials = {
    name:       process.env.NAME,
    password:   process.env.PASSWORD,
    appId:      "Sample App",
    appVersion: "1.0",
    cid:        process.env.CID,
    sec:        process.env.SEC,
    deviceId:   process.env.DEVICEID
}
const getauthed = async (account) => {
    const response = await axios.post(`https://${account}.tradovateapi.com/auth/accessTokenRequest`, credentials, {
        headers: {
            'Content-Type': 'application/json'
        }
    })

    return response.data
}
const getSortedWorkingOrders = async (account, token = null) => {
    let accessToken
    if (token === null) {
        const res = await getauthed(account)
        accessToken = res.accessToken
    } else {
        accessToken = token
    }
    const orderList = await axios.get(`https://${account}.tradovateapi.com/v1/order/list`, {
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        }
    })
    const workingOrders = orderList.data.filter(order => order.ordStatus == "Working")
    const sortedWorkingOrders = workingOrders.sort((a,b) => {
        first = new Date(a.timestamp)
        second = new Date(b.timestamp)
        return second - first
    })

    return {sortedWorkingOrders}
}

const flatten = async (account, contractToFlatten, token = null) => {
    // const {accessToken} = await getauthed(account)
    let accessToken
    if (token === null) {
        const res = await getauthed(account)
        accessToken = res.accessToken
    } else {
        accessToken = token
    }

    // FIRST: liqudate positions --------------------------------------------------------------------------------------------------------------------
        const contractResponse = await axios.get(`https://${account}.tradovateapi.com/v1/contract/find?name=${contractToFlatten}`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                }
            })
        const contractID = contractResponse.data.id
        let flattenResponse = null
        const LiquidatePosistions = async (contractID) => {
            flattenResponse = await axios.post(`https://${account}.tradovateapi.com/v1/order/liquidateposition`, contractID, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                }
            })
        }
        // Liquidate all positions related to the contract ID (contract is something like MNQZ3, or ESZ3, but they all have unique Tradovate IDs)
        LiquidatePosistions(
            {
                "accountId": account === 'live' ? parseInt(process.env.LIVEID) : parseInt(process.env.DEMOID),
                "contractId": contractID,
                "admin": false
            }
        )  

    // SECOND: Delete pending/suspended orders --------------------------------------------------------------------------------------------------------------------
        const { sortedWorkingOrders } = await getSortedWorkingOrders(account)
        const deleteOrder = async (id) => {
            await axios.post(`https://${account}.tradovateapi.com/v1/order/cancelorder`, id, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                }
            })
        }
        // console.log(sortedWorkingOrders[0])
        sortedWorkingOrders.forEach(order => {
            if (order.accountId === contractID) {
                deleteOrder({orderId: order.id})
            }
        })  

        console.log('end of flatten function', Date.now())
        return sortedWorkingOrders
}

// Routes
app.get('/:account/order/flatten/:contractToFlatten', urlencodedParser, jsonParser, async function(req, res, next) {
    flatten(req.params.account, req.params.contractToFlatten)

    res.send('Positions liqidated and orders cancelled (ie "flattened")')
})

app.get('/:account/order/list', urlencodedParser, jsonParser, async function(req, res, next) {
    const {accessToken} = await getauthed(req.params.account)

    const response = await axios.get(`https://${req.params.account}.tradovateapi.com/v1/order/list`, {
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        }
    })

    res.send(response.data)
})

app.post("/order/placeoso", urlencodedParser, jsonParser, async function(req, res, next) {
    const contractToFlatten = req.body.symbol
    try {
        if (req.body.name === "Close Last Order") {
            res.redirect('/order/cancelLast')
        } else if (req.body.name === "flatten") {
            res.redirect(`/${req.body.account}/order/flatten/${contractToFlatten}`)
        } else {
            let accountID 
            if (req.body.account === 'demo') {
                accountType = 'demo'
                accountID = parseInt(process.env.DEMOID)
            } else if (req.body.account === 'live') {
                accountType = 'live'
                accountID = parseInt(process.env.LIVEID)
            } else {
                console.log('Please supply an account type ("live" or "demo")')
                console.log(req.body)
                res.send('Please supply an account type ("live" or "demo")')
            }

            const {accessToken} = await getauthed(req.body.account)

            if (!accountID){
                res.send('Missing accountID')
            }
            if (!req.body.account){
                res.send('Missing account type, "live" or "demo"')
            }

            const sendOrder = async () => {
                const balanceInfo = await axios.post(`https://${req.body.account}.tradovateapi.com/v1/cashBalance/getcashbalancesnapshot`, {"accountId": accountID}, {
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                    }
                })
                const order = req.body
                const accountvalue = balanceInfo.data.totalCashValue
                const initialMargin = balanceInfo.data.initialMargin

                if (!order){
                res.send('Missing order')
                }
                if (!accountvalue){
                    res.send('Missing accountvalue')
                }
                if (!initialMargin){
                    res.send('Missing initialMargin')
                }
                console.log('-------------------------------------------------')
                console.log('the order is: ', order)
                console.log('the accountID is: ', accountType === 'live' ? process.env.LIVEID : process.env.DEMOID)
                console.log('the account Value is: ', accountvalue)
                console.log('order qty is : ', order.orderQty)
                console.log('initial Margin is: ', initialMargin)
                console.log('-------------------------------------------------')
                
                const orderOBJ = {
                    accountSpec: accountType === 'live' ? process.env.LIVESPEC : process.env.DEMOSPEC,
                    accountId: accountType === 'live' ? parseInt(process.env.LIVEID) : parseInt(process.env.DEMOID),
                    action: order.action,
                    symbol: order.symbol,
                    // orderQty: order.orderQty > maxOrderQty ? maxOrderQty : order.orderQty,
                    orderQty: order.orderQty,
                    orderType: order.orderType,
                    // expireTime: expTime,
                    price: order.orderType === "Stop" || order.orderType === "Market" ? null : order.price,
                    stopPrice: order.orderType === "Stop" ? order.price : null,
                    isAutomated: true, 
                    timeInForce: "GTC",
                    bracket1: {
                        action: order.action === "Buy" ? "Sell": "Buy",
                        orderType: 'Limit',
                        price: order.takeProfitPrice,
                        timeInForce: "GTC",
                        // expireTime: expTime,
                    },
                    bracket2: {
                        action: order.action === "Buy" ? "Sell": "Buy",
                        orderType: 'Stop',
                        stopPrice: order.stopLossPrice,
                        timeInForce: "GTC",
                        // expireTime: expTime,
                    }
                }

                const response = await axios.post(`https://${req.body.account}.tradovateapi.com/v1/order/placeoso`, orderOBJ, {
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                    }
                })

                res.send(response.data)            
            }

// flatten
//-------------------------------------------------------------------------------------------------------------------------------------------------------------
            const workingOrds = await getSortedWorkingOrders(req.body.account, accessToken)
            if (workingOrds && workingOrds.sortedWorkingOrders.length > 0) {
                // FIRST: liqudate positions --------------------------------------------------------------------------------------------------------
                const contractResponse = await axios.get(`https://${req.body.account}.tradovateapi.com/v1/contract/find?name=${contractToFlatten}`, {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${accessToken}`,
                        }
                })
                const contractID = contractResponse.data.id
                let flattenResponse = null
                const LiquidatePosistions = async (contractID) => {
                    flattenResponse = await axios.post(`https://${req.body.account}.tradovateapi.com/v1/order/liquidateposition`, contractID, {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${accessToken}`,
                        }
                    })
                }
                // Liquidate all positions related to the contract ID (contract is something like MNQZ3, or ESZ3, but they all have unique Tradovate IDs)
                LiquidatePosistions(
                    {
                        "accountId": req.body.account === 'live' ? parseInt(process.env.LIVEID) : parseInt(process.env.DEMOID),
                        "contractId": contractID,
                        "admin": false
                    }
                )  

                // SECOND: Delete pending/suspended orders --------------------------------------------------------------------------------------------
                let deletedOrderResponse = null
                const { sortedWorkingOrders } = await getSortedWorkingOrders(req.body.account)
                const deleteOrder = async (id) => {
                    deletedOrderResponse = await axios.post(`https://${req.body.account}.tradovateapi.com/v1/order/cancelorder`, id, {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${accessToken}`,
                        }
                    })
                }
                
                sortedWorkingOrders.forEach(order => {
                    if (order.accountId === contractID) {
                        deleteOrder({orderId: order.id})
                    }
                }) 
                    
                console.log('in flatten before Promise.all', Date.now())
                Promise.all([contractResponse, flattenResponse, deletedOrderResponse]).then((values) => {
                    console.log("all promises resolved");
                    // console.log("values...", values);
                    setTimeout(() => {
                        sendOrder()
                    }, 200);
                }).catch((reason) => {
                    console.log('resason in promise.all catch', reason);
                });

                
            } else {
                sendOrder()
            }    
        }                        
    } catch (error) {
        console.log("console logging error in placeoso")
        console.log(error.message)
        // res.send('error in plaseoso')
    }
});


// error handler
app.use((err, req, res, next) => {
    res.status(500).send('Something broke!')
    
    res.send({
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? err.stack : err.stack
    })
})

server.listen(80, () => {
  console.log('Server is listening on localhost:80');
});