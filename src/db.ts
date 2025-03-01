import { Logger, Player, SQLDataType, SQLDataTypeEnum, SQLite3 } from "../lib";
import { data_path } from "../lib/plugin_info";
import { conf } from "./config";

export const db=new SQLite3(data_path+"/data.db");
db.initTable("player_info",{
    name:"uuid",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT),
    constraint:{
        primary_key:true
    }
},{
    name:"xuid",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
},{
    name:"name",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
})
db.initTable("transfer_records",{
    name:"id",
    data_type:new SQLDataType(SQLDataTypeEnum.INTEGER),
    constraint:{
        primary_key:true
    },
    auto_increment:true
},{
    name:"transfer_time",
    data_type:new SQLDataType(SQLDataTypeEnum.INTEGER),
},{
    name:"transfer",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
},{
    name:"reciever",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)
},{
    name:"amount",
    data_type:new SQLDataType(SQLDataTypeEnum.REAL)
},{
    name:"added_values",
    data_type:new SQLDataType(SQLDataTypeEnum.TEXT)

})
export function initPlayerInfo(player:Player){
    
    //更新玩家的身份信息
    try{
        db.setRowFromPrimaryKey("player_info",player.uuid,{
            columnName:"xuid",
            value:player.xuid
        },{
            columnName:"name",
            value:player.name
        })        
    }
    catch(e){
        Logger.error("无法更新玩家"+player.name+"的身份信息："+e)
        return;
    }
}
export function name2uuid(name:string):string|undefined{
    const result=db.queryAllSync(`SELECT uuid FROM player_info WHERE name=?`,name)
    if(result.length==0)return undefined
    if(result.length>1)Logger.warn("坏了，真的出现了多个人共用同一个玩家名的情况")
    return result[0].uuid
}
export function uuid2name(uuid:string):string|undefined{
    return db.getRowFromPrimaryKey("player_info",uuid).get("name")
}
export function uuid2displayName(uuid:string):string{
    const result=uuid2name(uuid)
    return result===undefined?"[未找到玩家名称]":result
}
export function recordTransfer(transfer:string,reciever:string,amount:number,date=new Date()){
    db.runSync(`INSERT INTO transfer_records (transfer,reciever,amount,transfer_time,added_values) VALUES (?,?,?,?,?)`,transfer,reciever,amount,date.getTime(),JSON.stringify({}))
}
export function reachedDailyLimit(uuid:string,currentTransferAmount:number):boolean{
    const now=new Date()
    const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()
    //今天所有和这个人有关的转账记录
    const asReciever=db.queryAllSync(`SELECT reciever,amount FROM transfer_records WHERE reciever=? AND transfer_time>=?`,uuid,todayStart)
    const asTransfer=db.queryAllSync(`SELECT transfer,amount FROM transfer_records WHERE transfer=? AND transfer_time>=?`,uuid,todayStart)
    let total=0
    for(let record of asReciever){
        total+=record.amount
    }
    for(let record of asTransfer){
        total+=record.amount
    }
    const dailyLimit=conf.get("daily_limit")
    if(dailyLimit==0)return false
    else return total+currentTransferAmount>dailyLimit
}
export function purgePlayerTransferRecords(playerUUID:string){
    db.runSync(`DELETE FROM transfer_records WHERE transfer=?`,playerUUID)
}
export function getPlayerPurge(playerUUID:string){
    //直接返回了玩家所有的转账记录，可能存在一定的性能问题
    return db.queryAllSync(`SELECT * FROM transfer_records WHERE transfer=? OR reciever=?`,playerUUID,playerUUID).map(record=>{
        record.transfer_time=new Date(record.transfer_time)
        return record
    })
}