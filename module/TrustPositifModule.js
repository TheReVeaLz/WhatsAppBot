import axios from "axios";
import https from "https";

function GetString(data) {
    let str = "";

    for(let i = 0; i < data.length; i++) {
        str += `*URL: ${data[i].Domain}*\n`;
        str += `KETERANGAN: ${data[i].ket}\n`;
        str += `LAST CHECK: ${new Date(data[i].lastCheck).toLocaleString()}\n\n`;
    }

    return str == "" ? "DATA NOT FOUND" : str.trimEnd();
}

export default class TrustPostitifChecker {
    constructor(domainList) {
        this.table = domainList;
        this.dailyReport = [];
        this.lastReport = new Date();
        this.httpsAgent = new https.Agent({  
            rejectUnauthorized: false
        });
    }

    GetList() {
        const str = GetString(this.table);

        if (str.length == 0)
            return "DATA NOT FOUND";

        return str;
    }
    
    ReportUpdate(data, message) {
        const str = GetString(data);
        
        return message == "" || !message ? str : `=====${message}=====\n${str}`;
    }
    
    AddDomain(domain) {
        let msg = "";
        
        for (let i = 0; i < domain.length; i++) {
            if (domain[i] == "")
                continue;

            if (this.table.findIndex((item) => (item.Domain == domain[i])) != -1) {
                console.log(`${domain[i]} ALREADY EXIST.\n`);
                msg += `${domain[i]} ALREADY EXIST.\n`;
                continue;
            }
        
            this.table.push({ Domain: domain[i] });
            msg += `${domain[i]} SUCCESSFULLY ADDED.\n`;
        }
        
        return msg.trim();
    }
    
    RemoveDomain(domain) {
        let msg = "";
        
        for (let i = 0; i < domain.length; i++) {
            if (domain[i] == "")
                continue;

            const index = this.table.findIndex((item) => (item.Domain == domain[i]));

            if (index == -1) {
                console.log(`${domain[i]} NOT FOUND.\n`);
                msg += `${domain[i]} NOT FOUND.\n`;
                continue;
            }
        
            this.table.splice(index, 1);
            msg += `${domain[i]} SUCCESSFULLY REMOVED.\n`;
        }
        
        return msg.trim();
    }
    
    ResetTable() {
        this.table.length = 0;
        return "LIST HAS BEEN CLEARED."
    }
    
    async Check() {
        try {
            let CsReqData = "";
        
            for(let i = 0; i < this.table.length; i++) {
                if (i > 0) 
                    CsReqData += "\n";
                CsReqData += this.table[i].Domain;
            }
        
            const { data } = await axios.post("https://trustpositif.kominfo.go.id/Rest_server/getrecordsname", 
            { 
                name: CsReqData 
            }, 
            { 
                httpsAgent: this.httpsAgent, 
                headers: { 
                    'Content-Type': 'application/json' 
                } 
            });
            
            const today = new Date();
            const { values } = data;
            const newData = [];
    
            for(let i = 0; i < values.length; i++) {
                const tableIndex = this.table.findIndex((item) => (item.Domain == values[i].Domain));
                if (tableIndex == -1)
                    continue;

                let updated = false;
                
                for(const [_keys, _values] of Object.entries(values[i])) {
                    if (this.table[tableIndex][_keys] != _values)
                        updated = true;
                    this.table[tableIndex][_keys] = _values;
                }
                this.table[tableIndex].lastCheck = today;
    
                if (updated) {
                    if (this.table[tableIndex].ket.toLowerCase().includes("block")){
                        this.dailyReport.push(this.table[tableIndex]);
                        newData.push(this.table[tableIndex]);
                        this.table.splice(tableIndex, 1);
                    }
                }
            }
    
            if (newData.length) {
                return this.ReportUpdate(newData, "NEW UPDATE");
            } else if (this.lastReport.getDay() != today.getDay()) {
                const msg = (this.dailyReport.length) ? this.ReportUpdate(this.dailyReport, "DAILY REPORT") : null;
                this.dailyReport.length = 0;
                this.lastReport = today;
                return msg;
            }
    
            return null;
        } catch (err) {
            return err.message;
        }
    }
}