// ==UserScript==
// @name         UCM
// @namespace    http://tampermonkey.net/
// @version      0.32
// @description  turn your data into something that makes sense
// @author       UCM
// @match        https://shield.usitech-int.com/*
// @grant        none
// @updateURL    https://github.com/usicoinmanager/UCM/raw/master/ucm.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/vue/2.5.13/vue.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/axios/0.17.1/axios.min.js

// ==/UserScript==

(function() {
    'use strict';
    const version = 0.32; //test of the update function
    const promiseSerial = funcs => funcs.reduce((promise, func) => promise.then(result => func().then(Array.prototype.concat.bind(result))), Promise.resolve([]));
    function parsePackagePopup(r){
        r = r.replace('setpopup(', '').replace(')', '').split("'").join("").split(" ").join("");
        var arr = r.split(",");

        var pck = {
            id: arr[1],
            status: arr[2],
            date: {
                created: arr[3],
                approved: arr[4]
            },
            qty: arr[5],
            amount: arr[6] + "." + arr[7],
            fee: arr[8],
            payout: arr[9].split("<sub>")[0],
            history: []
        };
        arr[10].split("|").forEach( day => {
            var d = day.split("^");
            pck.history.push({
                date: d[0],
                payout: d[1],
                day: d[2]
            });
        });
        return pck;
    }
    function parseTokenPopup(r){
        return r;
    }
    function parseCommission(r){
        return r;
    }
    function injectPage(){
        new Vue({
            el: 'section',
            template: `
     <section>
        <div class="content-wrapper">
           <div class="content-heading" style="margin-bottom:10px;">
               <h3 class="mt0 mb0">UCM Updater</h3>
		   </div>
           <div class="col-lg-12">
              <div v-show="status.maintenance">
                <h5>System maintenance</h5>
                <p>We are updating the UCM system, and you can not send any data at the moment, try again later</p>
              </div>

              <div v-show="update" class="mb-3">
                <h5>Update</h5>
                <p>There is an update available</p>
                <a href="https://github.com/usicoinmanager/UCM/raw/master/ucm.user.js" class="btn btn-success">Update now</a>
              </div>

              <div v-show="!status.maintenance">

                 <h5>Details:</h5>
                 <p>Last transfer: {{ status.last_date }}</p>

                 <h5>Tasks:</h5>
                 <p>Active packages: {{ status.packages.active }}</p>
                 <p>Completed packages: {{ status.packages.completed }}</p>
                 <p style="color: #c0c0c0;">Token packages: {{ status.packages.token }}</p>
                 <p style="color: #c0c0c0;">Commissions: {{ status.commissions }}</p>
                 <p>Sending data to UCM: {{ status.sending }}</p>

                 <button class="btn btn-primary" v-on:click="start" :disabled="running || !ready">Start data transfer</button>
              </div>
           </div>
        </div>
     </section>
`,
            data: {
                update: false,
                partner_id: 0,
                ready: false,
                running: false,
                payload: {
                    active_pck: [],
                    completed_pck: [],
                    token_pck: [],
                    commissions: []
                },
                paths: {
                    packages: {
                        active:      'https://shield.usitech-int.com/news.dhtml?a=1&usepage=info_packagestatus_active.html',
                        completed:   'https://shield.usitech-int.com/news.dhtml?a=1&usepage=info_packagestatus_active.html&pdisp=c',
                        token:       'https://shield.usitech-int.com/news.dhtml?a=1&usepage=info_packagestatus_active.html&pdisp=t'
                    },
                    commissions:     'https://shield.usitech-int.com/news.dhtml',
                    ucm: {
                        commit: 'https://beta.usicoinmanager.com/api/v1/import',
                        status: 'https://beta.usicoinmanager.com/api/v1/import/status'
                    }
                },
                status: {
                    packages: {
                        active: "waiting", //queued, pending, retriving, analyzing, sending
                        completed: "waiting",
                        token: "coming soon"
                    },
                    commissions: "coming soon",
                    sending: "waiting",
                    last_date: "loading..",
                    maintenance: false
                }
            },
            mounted(){
                this.ready = true;
                this.partner_id = document.querySelector("a[href*=xuserid]").getAttribute('href').split('xuserid=')[1].split("&")[0];

                axios(this.paths.ucm.status + "/" + this.partner_id, {
                        method: "get",
                        data: {payload: this.payload},
                        withCredentials: true
                    }).then( r => {
                    if(r.data && r.data.version){
                        if(parseFloat(r.data.version) > version){
                            this.update = true;
                        }
                    }
                    if(r.data && r.data.user){
                        this.status.maintenance = r.data.maintenance;
                        this.status.last_date = r.data.last_update.date;
                        this.ready = true;
                        console.log(r.data);
                    }else{
                        //login is required
                        console.log("user is not loggedin");
                    }

                    }).catch( error => this.status.last_date = "Failed to connect to UCM, try again later");
            },
            methods: {
                start(){
                    this.running = true; //disable the button.

                    const actions = ['active', 'completed' /*, 'token', 'commissions'*/];
                    const steps = actions.map(act => () => this.fetch(act).then( () => {} ));

                    promiseSerial(steps).then( () => this.commit() );

                },
                fetch(type){
                    return new Promise( (resolve, reject) => {
                        switch(type){
                            case "active":
                                this.status.packages.active = "loading..";
                                axios.get(this.paths.packages.active).then( res => {
                                    var $dom = jQuery(res.data);
                                    var pck = 0;
                                    $dom.find("table#g-u-table-default tbody tr").each( (index, row) => {
                                        pck += parseInt( jQuery(row).find("td:eq(4)").html() );
                                        var x =  parsePackagePopup(jQuery(row).find("td:first a").attr("onclick"));
                                        x.payment = jQuery(row).find("td:eq(3)").html();
                                        x.runtime = x.history.length;
                                        this.payload.active_pck.push(x);
                                    });
                                    this.status.packages.active = pck + " packages loaded";
                                    resolve("active");
                                });
                                break;

                            case "completed":
                                this.status.packages.completed = "loading..";
                                axios.get(this.paths.packages.completed).then( res => {
                                    var $dom = jQuery(res.data);
                                    var pck = 0;
                                    $dom.find("table#g-u-table-default tbody tr").each( (index, row) => {
                                        pck += parseInt( jQuery(row).find("td:eq(4)").html() );
                                        var x =  parsePackagePopup(jQuery(row).find("td:first a").attr("onclick"));
                                        x.payment = jQuery(row).find("td:eq(3)").html();
                                        x.runtime = x.history.length;
                                        this.payload.active_pck.push(x);
                                    });
                                    this.status.packages.completed = pck + " packages loaded";
                                    resolve("completed");
                                });
                            break;

                            case "token":
                                this.status.packages.token = "loading..";
                                axios.get(this.paths.packages.token).then( res => {
                                    var $dom = jQuery(res.data);
                                    var pck = 0;
                                    $dom.find("table#g-u-table-default tbody tr").each( (index, row) => {
                                        pck += parseInt( jQuery(row).find("td:eq(4)").html() );
                                        this.payload.token_pck.push( parseTokenPopup(jQuery(row).find("td:first a").attr("onclick")) );
                                    });
                                    this.status.packages.token = pck + " packages loaded";
                                    resolve("token");
                                });
                            break;

                            case "commissions":
                                const data = new FormData();
                                this.status.commissions = "loading..";
                                data.append('usepage', 'info_commissions.html');
                                data.append('xuserid', this.partner_id);
                                data.append('maincaladddate', '2017-12-16');
                                data.append('monthadddate', '12');
                                data.append('dayadddate', '16');
                                data.append('yearadddate', '2017');
                                axios.post(this.paths.commissions, data).then( r => {
                                    var $dom = jQuery(r.data);
                                    var pck = 0;
                                    $dom.find("table#g-u-table-default tbody tr").each( (index, row) => {
                                        pck += parseInt( jQuery(row).find("td:eq(4)").html() );
                                        this.payload.commissions.push( parseCommission(row.innerHTML) );
                                    });
                                    this.status.commissions = pck + " packages loaded";
                                });
                                resolve("commissions");
                                break;

                            default:
                                //reject(1);
                        }
                    });
                },
                commit(){
                    this.status.sending = "sending..";

                    //only send first package history.
                    if(this.payload.completed_pck.length > 0){
                        //ingen history poå aktive
                        this.payload.active_pck.forEach( (p) => p.history = false );
                        //første completed, fuld history
                        this.payload.completed_pck.forEach( (p, idx) => {
                            if(idx < this.payload.active_pck.length-1){
                                p.history = false;
                            }
                        });
                    }else{
                        //ælste pakke fuld history,
                        this.payload.active_pck.forEach( (p, idx) => {
                            if(idx < this.payload.active_pck.length-1){
                                p.history = false;
                            }
                        });
                    }

                    axios(this.paths.ucm.commit, {
                        method: "post",
                        data: {payload: this.payload},
                        withCredentials: true
                    }).then( r => {
                        this.status.sending = "completed";
                        console.log(r.data);
                    });
                }
            }
        });
    }

    function injectMenu(){
        var li = document.createElement("LI");
        var a = document.createElement("A");
        a.href = "#";
        a.innerHTML = '<em class="fa fa-cloud-upload"></em><span>UCM Updater</span>';
        a.style = "color: #fff;";
        li.addEventListener("click", injectPage);
        li.style = "background-color: #1e2835;";
        li.appendChild(a);
        document.querySelector(".aside ul.nav").appendChild(li);
    }

    function pckCountMatch(){
        //if dashboard, check total package count = last data from ucm, if not prompt user to upload or do it in the background.
    }

    injectMenu();
    pckCountMatch();
})();
