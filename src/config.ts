import { YMLFile } from "../lib";
import {data_path} from "../lib/plugin_info.js"

export const conf=new YMLFile(data_path+"/config.yml")
conf.init("name","money")
conf.init("daily_limit",0)
conf.init("cmd",{
    pay:"pay",
    mgr:"paymgr"
})
export const cmdConf=new YMLFile(data_path+"/config.yml",["cmd"])
cmdConf.init("records","payrecords")