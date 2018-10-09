/* jshint strict: true */
/* global console, require, module, process */
"use strict";

const http = require('http');
http.globalAgent.maxSockets = 50;

const https = require('https');
https.globalAgent.maxSockets = 50;

const moment      = require('moment'),
    momenttz    = require('moment-timezone'),
    Promise     = require('bluebird'),
    _           = require('lodash');


function formatAddressText(street1, street2, suburb, postalCode) {
    return street1
        + (street2 ? ", " + street2 : (suburb ? ", " + suburb : ""))
        + (postalCode ? " " + postalCode : "");
}

function formatWindowText(date, startTime, endTime) {
    momenttz.tz.setDefault("Australia/Sydney");
    return momenttz(date).calendar(null, { sameDay: '[Today]', nextDay: '[Tomorrow]', nextWeek: 'dddd', lastDay: '[Yesterday]', lastWeek: '[Last] dddd'})
        + " between "
        + moment(startTime).format("h:mma")
        + " and "
        + moment(endTime).format("h:mma");
}

function getWowRewardsRedeemMessage(loyalty, redeemableWowRewardsDollars){
    
    let saveForLaterPreference = (loyalty.SaveForLaterPreference) ? (loyalty.SaveForLaterPreference).toLowerCase() : '';
    
    switch (saveForLaterPreference) {
        case 'christmas':
            if(redeemableWowRewardsDollars >= 10)
            {
                loyalty.WowRewardsRedeemMessage = "You've saved $" + redeemableWowRewardsDollars +" for christmas";
            }
            else{
                loyalty.WowRewardsRedeemMessage = "Saving for Christmas";
            }
            break;
        case 'quarterly_qff':
            if(redeemableWowRewardsDollars >= 10)
            {
                loyalty.WowRewardsRedeemMessage = "You've saved $" + redeemableWowRewardsDollars +" on Qantas";
            }
            else{
                loyalty.WowRewardsRedeemMessage = "Saving for Qantas";
            }
            break;
        //case 'Automatic': //or any other
        default:
            if(redeemableWowRewardsDollars >= 10)
            {
                loyalty.WowRewardsRedeemMessage = "$" + redeemableWowRewardsDollars +" to spend";
            }
            else{
                loyalty.WowRewardsRedeemMessage = "Save $10 every 2000 points";
            }
    } 
    return loyalty;
}

function getObjectValue(label, value, type)
{
    return { "Label": label, "Value": value, "Type": type };
}

function getOrderTotalsTableData(order, loyalty)
{
    
    let orderTotalsTableData = [];
    let amountType = { plain : "plain", negative : "negative", points : "points", total : "total"};
    
    /* you saved section */
    let arrSavedSection = [];
    
    if(order && parseFloat(order.Savings))
    {
        arrSavedSection.push(getObjectValue("You've saved", "$"+(parseFloat(order.Savings)).toFixed(2), amountType.negative));
    }
    if(loyalty && parseInt(loyalty.Points))
    {
        arrSavedSection.push(getObjectValue("You'll earn", loyalty.Points+" "+amountType.points, amountType.points));
    }

    if(arrSavedSection.length > 0)
    orderTotalsTableData.push(arrSavedSection);
    
    /* main breakdown section */
    let arrMainSection = [];

    let subtotal = (order && parseFloat(order.Subtotal)) ? parseFloat(order.Subtotal) : 0;
    arrMainSection.push(getObjectValue("Subtotal", "$"+(subtotal).toFixed(2), amountType.plain));

    let deliveryFee = (order && parseFloat(order.DeliveryFee)) ? parseFloat(order.DeliveryFee) : 0;
    arrMainSection.push(getObjectValue("Delivery fee", "$"+(deliveryFee).toFixed(2), amountType.plain));

    if(order && parseFloat(order.PackagingFeeLabel))
    {
        arrMainSection.push(getObjectValue(order.PackagingFeeLabel, "$"+(parseFloat(order.PackagingFee)).toFixed(2), amountType.plain));
    }
    if(order && parseFloat(order.DeliveryFeeDiscount))
    {
        arrMainSection.push(getObjectValue("Delivery fee discount", "-$"+(parseFloat(order.DeliveryFeeDiscount)).toFixed(2), amountType.negative));
    }
    if(order && parseFloat(order.OrderDiscount))
    {
        arrMainSection.push(getObjectValue("Order discount", "-$"+(parseFloat(order.OrderDiscount)).toFixed(2), amountType.negative));
    }
    if(order && parseFloat(order.TeamDiscount))
    {
        arrMainSection.push(getObjectValue("Team member discount", "-$"+(parseFloat(order.TeamDiscount)).toFixed(2), amountType.negative));
    }

    orderTotalsTableData.push(arrMainSection);
    
    /* total section*/
    let arrTotalSection = [];

    let totalIncludingGst = (order && parseFloat(order.TotalIncludingGst)) ? parseFloat(order.TotalIncludingGst) : 0;
    arrTotalSection.push(getObjectValue("Total (incl. GST)", "$"+(totalIncludingGst).toFixed(2), amountType.total));
    orderTotalsTableData.push(arrTotalSection);
    
    /* payment section */
    let arrPaymentSection = [];
    
    if(order && parseFloat(order.StoreCreditTotal))
    {
        arrPaymentSection.push(getObjectValue("Store credit", "-$"+(parseFloat(order.StoreCreditTotal)).toFixed(2), amountType.negative));
    }
    if(order && parseFloat(order.WowRewardsPaymentAmount))
    {
        arrPaymentSection.push(getObjectValue("Woolworths Rewards", "-$"+(parseFloat(order.WowRewardsPaymentAmount)).toFixed(2), amountType.negative));
    }
    if(order && order.GiftCardPayments)
    {
        _.each(order.GiftCardPayments, function (giftCardPayments) {
            arrPaymentSection.push(getObjectValue("Gift card " + giftCardPayments.GiftCardNumber, "-$"+(parseFloat(giftCardPayments.Amount)).toFixed(2), amountType.negative));
        });
    }

    if(arrPaymentSection.length > 0)
    orderTotalsTableData.push(arrPaymentSection);

    /* total balance section */
    let arrBalanceSection = [];
    
    if(order && parseFloat(order.BalanceToPay) !== parseFloat(order.TotalIncludingGst))
    {
        arrBalanceSection.push(getObjectValue("Still to pay", "$"+(parseFloat(order.BalanceToPay)).toFixed(2), amountType.total));
    }

    if(arrBalanceSection.length > 0)
    orderTotalsTableData.push(arrBalanceSection);

    return orderTotalsTableData;
}

module.exports.processFulfilmentResponse = function processFulfilmentResponse(response) {
	
	console.log('processFulfilmentResponse');

    return new Promise(function (resolve, reject) {

        var Fulfilment = (function () {
            function Fulfilment(primaryAddress, delivery, pickup, instructions, savings, teamDiscount,
                                orderDiscount, subtotal, packagingFee, packagingFeeLabel, deliveryFee,
                                deliveryFeeDiscount, balanceToPay, totalIncludingGst, wowRewardsPaymentAmount,
                                redeemableWowRewardsDollars, deferredWowRewardsDollars, storeCreditTotal, loyalty, discounts,
                                giftCardPayments, unavailableOrderItems, restrictedOrderItems, exceededSupplyLimitProducts, 
                                restrictedProductsByDeliveryMethod, restrictedProductsByDeliPlatter, errors, canProceedToPayment)
            {
                if (primaryAddress === void 0) { primaryAddress = {}; }
                if (delivery === void 0) { delivery = {}; }
                if (pickup === void 0) { pickup = {}; }
                if (instructions === void 0) { instructions = ""; }
                if (savings === void 0) { savings = null; }
                if (teamDiscount === void 0) { teamDiscount = null; }
                if (orderDiscount === void 0) { orderDiscount = ""; }
                if (subtotal === void 0) { subtotal = null; }
                if (packagingFee === void 0) { packagingFee = null; }
                if (packagingFeeLabel === void 0) { packagingFeeLabel = ""; }
                if (deliveryFee === void 0) { deliveryFee = null; }
                if (deliveryFeeDiscount === void 0) { deliveryFeeDiscount = null; }
                if (balanceToPay === void 0) { balanceToPay = null; }
                if (totalIncludingGst === void 0) { totalIncludingGst = null; }
                if (wowRewardsPaymentAmount === void 0) { wowRewardsPaymentAmount = null; }
                if (redeemableWowRewardsDollars === void 0) { redeemableWowRewardsDollars = null; }
                if (deferredWowRewardsDollars === void 0) { deferredWowRewardsDollars = null; }
                if (storeCreditTotal === void 0) { storeCreditTotal = null; }
                if (loyalty === void 0) { loyalty = {}; }
                if (discounts === void 0) { discounts = []; }
                if (giftCardPayments === void 0) { giftCardPayments = []; }
                if (unavailableOrderItems === void 0) { unavailableOrderItems = []; }
                if (restrictedOrderItems === void 0) { restrictedOrderItems = []; }
                if (exceededSupplyLimitProducts === void 0) { exceededSupplyLimitProducts = []; }
                if (restrictedProductsByDeliveryMethod === void 0) { restrictedProductsByDeliveryMethod = []; }
                if (restrictedProductsByDeliPlatter === void 0) { restrictedProductsByDeliPlatter = []; }
                if (errors === void 0) { errors = []; }
                if (canProceedToPayment === void 0) { canProceedToPayment = null; } 
                ///if (fulfilmentstoreid === void 0) { fulfilmentstoreid = null; }

                this.PrimaryAddress = primaryAddress;
                this.Delivery = delivery;
                this.Pickup = pickup;
                this.Instructions = instructions;
                this.Savings = savings;
                this.TeamDiscount = teamDiscount;
                this.OrderDiscount = orderDiscount;
                this.Subtotal = subtotal;
                this.PackagingFee = packagingFee;
                this.PackagingFeeLabel = packagingFeeLabel;
                this.DeliveryFee = deliveryFee;
                this.DeliveryFeeDiscount = deliveryFeeDiscount;
                this.BalanceToPay = balanceToPay;
                this.TotalIncludingGst = totalIncludingGst;
                this.WowRewardsPaymentAmount = wowRewardsPaymentAmount;
                this.RedeemableWowRewardsDollars = redeemableWowRewardsDollars;
                this.DeferredWowRewardsDollars = deferredWowRewardsDollars;
                this.StoreCreditTotal = storeCreditTotal;
                this.Loyalty = loyalty;
                this.Discounts = discounts;
                this.GiftCardPayments = giftCardPayments;
                this.UnavailableOrderItems = unavailableOrderItems;
                this.RestrictedOrderItems = restrictedOrderItems;
                this.ExceededSupplyLimitProducts = exceededSupplyLimitProducts;
                this.RestrictedProductsByDeliveryMethod = restrictedProductsByDeliveryMethod;
                this.RestrictedProductsByDeliPlatter = restrictedProductsByDeliPlatter;
                this.Errors = errors;
                this.CanProceedToPayment = canProceedToPayment;
                //this.fulfilmentstoreid = fulfilmentstoreid;
                //this.confirmationhref = confirmationhref;
            }
            return Fulfilment;
        })();
        var Delivery = (function () {
            function Delivery(address, window) {
                if (address === void 0) { address = {}; }
                if (window === void 0) { window = {}; }
                this.Address = address;
                this.Window = window;
            }
            return Delivery;
        })();
        var Pickup = (function () {
            function Pickup(store, window) {
                if (store === void 0) { store = {}; }
                if (window === void 0) { window = {}; }
                this.Store = store;
                this.Window = window;
            }
            return Pickup;
        })();
        var Address = (function () {
            function Address(id, text) {
                if (id === void 0) { id = null; }
                if (text === void 0) { text = ""; }
                //if (windowshref === void 0) { windowshref = req.basepath + '/windows'; }
                this.Id = id;
                this.Text = text;
                //this.windowshref = windowshref;
            }
            return Address;
        })();
        var Window = (function () {
            function Window(id, text, date, starttime, endtime) {
                if (id === void 0) { id = null; }
                if (text === void 0) { text = ""; }
                if (date === void 0) { date = ""; }
                if (starttime === void 0) { starttime = ""; }
                if (endtime === void 0) { endtime = ""; }
                this.Id = id;
                this.Text = text;
                this.Date = date;
                this.StartTime = starttime;
                this.EndTime = endtime;
            }
            return Window;
        })();

        var Order = (function () {
            function Order(fulfilment) {
                if (fulfilment === void 0) { fulfilment = null; }
                this.Order = fulfilment;
            }
            return Order;
        })();

        // var finalUrl = req.apigeeFlowParameters.onlineEndpoint + '/apis/v2/Checkout';
        // apigee.setVariable(req, 'target.url', finalUrl);

        // var options = {
            // method: 'GET',
            // url: finalUrl,
            // 'timeout':30000,
            // headers: req.apigeeFlowParameters.olympicHeaders
        // };

        var decorator = function (response) {

            return new Promise(function(resolve)
            {

                response.Caller = 'Order';

                //if the callout was unsuccessful, don't continue processing the response
                if (response.httpStatusCode !== 200)
                    return resolve(response);

                var result = response.Result;

                if (result.Window) {
                    var window = new Window(result.Window.Id, formatWindowText(result.Window.WindowDate, result.Window.StartTime, result.Window.EndTime), 
                                            result.Window.WindowDate, result.Window.StartTime, result.Window.EndTime);
                }
                if (result.Order) {
                    var order = result.Order;
                    var fulfilmentStoreId = order.FulfilmentStoreId;
                    if (order.DeliveryMethod === 'Courier') {
                        var address = new Address(order.AddressId, formatAddressText(order.DeliveryStreet1, order.DeliveryStreet2, order.DeliverySuburb, order.DeliveryPostalCode));
                        var delivery = new Delivery(address, window);
                    } else {
                        var store = new Address(fulfilmentStoreId, order.DeliveryCity);
                        var pickup = new Pickup(store, window);
                    }
                    var deliveryInstruction = order.DeliveryInstruction;

                    if(!(_.isEmpty(order.GiftCardPayments)))
                    {
                        let arrGiftCardPayments = []
                        _.each(order.GiftCardPayments, function (giftCardPayments) {
                            let giftCardNumber = giftCardPayments.GiftCardNumber;
                            //middle dot used for masking gift card number Unicode - 'U+00B7'
                            giftCardPayments.GiftCardNumber =  "···· " + giftCardNumber.substring(giftCardNumber.length-4, giftCardNumber.length);
                            arrGiftCardPayments.push(giftCardPayments);
                        });
                        order.GiftCardPayments = arrGiftCardPayments;
                    }
                }
                /*if (result.CanProceedToPayment) {
                 var confirmationHref = 'https://' + req.headers.host + '/wow/v2/commerce/checkout/payment';
                 }*/
                let loyalty = result.Loyalty;
                
                if(loyalty)
                {
                    if (loyalty.SaveForLaterPreference === null) {
                    } 
                    else {
                        loyalty.SaveForLaterPreference = loyalty.SaveForLaterPreference.toString().toUpperCase();
                        if (loyalty.SaveForLaterPreference == "QUARTERLYQFF"){
                            loyalty.SaveForLaterPreference = "QUARTERLY_QFF";
                        }
                        if (loyalty.SaveForLaterPreference == "UNDEFINED"){
                            loyalty.SaveForLaterPreference = "AUTOMATIC";
                        }
                    }
                    loyalty = getWowRewardsRedeemMessage(loyalty, order.RedeemableWowRewardsDollars)
                }

                var fulfilment = new Fulfilment(
                    result.PrimaryAddress,
                    delivery,
                    pickup,
                    deliveryInstruction,
                    order.Savings,
                    order.TeamDiscount,
                    order.OrderDiscount,
                    order.Subtotal,
                    order.PackagingFee,
                    order.PackagingFeeLabel,
                    order.DeliveryFee,
                    order.DeliveryFeeDiscount,
                    order.BalanceToPay,
                    order.TotalIncludingGst,
                    order.WowRewardsPaymentAmount,
                    order.RedeemableWowRewardsDollars,
                    order.DeferredWowRewardsDollars,
                    order.StoreCreditTotal,
                    loyalty,
                    order.Discounts,
                    order.GiftCardPayments,
                    order.UnavailableOrderItems,
                    order.RestrictedOrderItems,
                    order.ExceededSupplyLimitProducts,
                    order.RestrictedProductsByDeliveryMethod,
                    order.RestrictedProductsByDeliPlatter,
                    result.Errors,
                    result.CanProceedToPayment);

                response.Result = new Order(fulfilment);
                
                let orderTotalsTableData = getOrderTotalsTableData(order, loyalty);
                response.Result.OrderTotalsTableData = orderTotalsTableData;

                resolve(response);
            })
        };

        // var captureResponse = function(result) {
			
            // apigee.setVariable(req, 'targetResponse', JSON.stringify(result));
            
            // return new Promise(function (resolve, reject) {
                // resolve(result);
            // })
        // };

        // apigee.setVariable(req, 'targetRequest', JSON.stringify(options));

        decorator(response)
            //.then(captureResponse)
            //.then(assert200ResponseCode)
            //.then(decorator)
            .then(function(response) {
                //Pass the decorated response to the Promise.All resolved handler
                resolve(response);
            })
            .catch(function(error) {
                //Pass the error onto the Promise.All error handler
                reject(error);
            });

    })


};

exports.printMsg = function() {
  console.log('This message is from the common-utils');
}
