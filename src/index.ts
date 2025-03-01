import {Logger,InitEvent, PlayerJoinEvent, Command, CommandParam, CommandParamType, CommandParamDataType, Currency, Player, CommandExecutorType, InternalPermission, CommandEnum, CommandEnumOptions, CommandResult, CommandExecutor} from "../lib/index.js";
import { cmdConf, conf } from "./config.js";
import { db, getPlayerPurge, initPlayerInfo, name2uuid, purgePlayerTransferRecords, reachedDailyLimit, recordTransfer, uuid2displayName, uuid2name } from "./db.js";
InitEvent.on((e)=>{
    return true;
})
PlayerJoinEvent.on(e=>{
    initPlayerInfo(e.player)
})
let currencyTest:Currency|undefined;
try{
    currencyTest=new Currency(conf.get("name"))
}
catch(e){
    throw new Error("初始化经济系统时出现错误，请检查货币名称是否正确:"+e)
}
const currency=currencyTest
new Command(conf.get("cmd").pay,[
    new CommandParam(CommandParamType.Mandatory,"player_selector",CommandParamDataType.Player),
    new CommandParam(CommandParamType.Mandatory,"player_name",CommandParamDataType.String),
    new CommandParam(CommandParamType.Mandatory,"amount",CommandParamDataType.Int)
],[["player_selector","amount"],["player_name","amount"]],result=>{
    if(result.executor.type!=CommandExecutorType.Player){
        if(result.executor.type==CommandExecutorType.Console)Logger.error("控制台不是玩家，无法向其他人转账，请使用"+conf.get("cmd").mgr+"命令转账。")
        return
    }
    const player=result.executor.object as Player

    if(result.params.get("player_selector")?.value||result.params.get("player_name")?.value){
        const amount=result.params.get("amount")?.value
        if(amount===undefined)throw new Error("命令没有提供amount参数。")
        const playersUUID=getTargetPlayersUUIDFromParam(result)
        if(playersUUID.length==0)return;
        switch(pay(player.uuid,playersUUID,amount)){
            case TransferFailResult.SUCCESS:{
                const recieverName=(()=>{
                    let recieverNameStr=""
                    for(let recieverUUID of playersUUID){
                        recieverNameStr+=(uuid2displayName(recieverUUID)+",")
                    }
                    return recieverNameStr.slice(0,recieverNameStr.length-1)
                })()
                player.tell("您已成功向"+recieverName+"转账"+amount+"。")
                //告知所有转账目标，如果他们在线
                for(let recieverUUID of playersUUID){
                    const targetObject=Player.getOnlinePlayer(recieverUUID)
                    if(targetObject!==undefined)targetObject.tell(player.name+"向您转账了"+amount)
                }
                break;
            };
            case TransferFailResult.INSUFFICIENT_BALANCE:{
                player.tell("您的余额不足。")
                break;
            }
            case TransferFailResult.RECIEVER_DAILY_LIMIT:{
                player.tell("您的转账目标中，以下目标已达到他（们）当日转账额度的上限。")
                let foundReachedLimitPlayer=false
                //检查到底是谁余额不足
                for(let reciever of playersUUID){
                    if(reachedDailyLimit(reciever,amount)){
                        const recieverName=uuid2name(reciever)
                        if(recieverName===undefined)player.tell("UUID："+reciever+"，无法获取他的游戏名。")
                        else player.tell(recieverName)
                        foundReachedLimitPlayer=true
                    }
                }
                if(!foundReachedLimitPlayer)player.tell("没有找到任何达到当日转账额度上限的玩家，转账系统可能出现了一些小问题。")
                break;
            }
            case TransferFailResult.TRANSFER_DAILY_LIMIT:{
                player.tell("您已达到您当日转账额度的上限。")
                break;
            }
            case TransferFailResult.NOT_ONLINE:{
                player.tell("目前暂不支持向离线玩家转账，请联系管理员")
                break;
            }
        }
    }
},InternalPermission.Any)
new Command(cmdConf.get("records"),[
    new CommandParam(CommandParamType.Mandatory,"query",CommandParamDataType.Enum,new CommandEnum("query",["query"]),CommandEnumOptions.Unfold),
    new CommandParam(CommandParamType.Mandatory,"records",CommandParamDataType.Enum,new CommandEnum("records",["records"]),CommandEnumOptions.Unfold),
],[["query"],["query","records"]],result=>{
    if(result.executor.type!=CommandExecutorType.Player){
        if(result.executor.type==CommandExecutorType.Console)Logger.error("控制台不是玩家，无法查询自己的转账记录，请使用/"+conf.get("cmd").mgr+" <玩家名>命令查询。")
        return;
    }
    const player=result.executor.object as Player
    if(result.params.get("query")?.value){
        //查询自己的流水账
        if(result.params.get("records")?.value){
            for(let record of getPlayerPurge(player.uuid)){
                if(record.transfer==player.uuid) player.tell(dateTOCHS(record.transfer_time)+"向"+uuid2displayName(record.reciever)+"转账"+record.amount)
                else if(record.reciever==player.uuid)player.tell(dateTOCHS(record.transfer_time)+"，"+uuid2displayName(record.transfer)+"向您转账"+record.amount)
               
            }
            player.tell("以上是您所有的转账记录。")
        }
        //查询自己的余额
        player.tell("您当前的余额："+currency.get(player.uuid))
    }
},InternalPermission.Any)

new Command(conf.get("cmd").mgr,[
    new CommandParam(CommandParamType.Mandatory,"purge",CommandParamDataType.Enum,new CommandEnum("purge",["purge"]),CommandEnumOptions.Unfold),
    new CommandParam(CommandParamType.Mandatory,"player_selector",CommandParamDataType.Player),
    new CommandParam(CommandParamType.Mandatory,"player_name",CommandParamDataType.String),
],[["purge","player_selector"],["purge","player_name"]],result=>{
    if(result.params.get("purge")?.value){
        const playersUUID=getTargetPlayersUUIDFromParam(result)
        if(playersUUID.length==0)return;
        for(let playerUUID of playersUUID){
            purgePlayerTransferRecords(playerUUID)
            tellExecutor(result.executor,"成功清除了"+uuid2displayName(playerUUID)+"的转账记录")
        }
    }

})

function tellExecutor(executor:CommandExecutor,msg:string){
    switch(executor.type){
        case CommandExecutorType.Console:{
            Logger.info(msg);
            break;
        }
        case CommandExecutorType.Player:{
            executor.object.tell(msg)
            break;
        }
    }
}

enum TransferFailResult{
    SUCCESS,
    INSUFFICIENT_BALANCE,
    TRANSFER_DAILY_LIMIT,
    RECIEVER_DAILY_LIMIT,
    NOT_ONLINE
}

function pay(transferUUID:string,recieversUUID:string[],amount:number):TransferFailResult{
    //检查玩家经济数量是否足够
    if(currency.get(transferUUID)<amount*recieversUUID.length){
        return TransferFailResult.INSUFFICIENT_BALANCE;
    }
    //检查双方是否达到转账上限
    if(reachedDailyLimit(transferUUID,amount))return TransferFailResult.TRANSFER_DAILY_LIMIT;
    //为了不开始转账，所以此处单立一个for遍历接收者
    for(let reciever of recieversUUID){
        if(reachedDailyLimit(reciever,amount))return TransferFailResult.RECIEVER_DAILY_LIMIT;
    }
    for(let reciever of recieversUUID){
        if(Player.getOnlinePlayer(reciever)===undefined)return TransferFailResult.NOT_ONLINE
        //扣除当前玩家经济
        currency.reduce(transferUUID,amount)
        //增加转账目标经济
        currency.add(reciever,amount)
        //转账成功后记录转账
        recordTransfer(transferUUID,reciever,amount)
    }
    return TransferFailResult.SUCCESS
}

function getTargetPlayersUUIDFromParam(result:CommandResult):string[]{
    const player=result.executor.object as Player
    let playersUUID:string[]|undefined
    if(result.params.get("player_selector")?.value){
        playersUUID=result.params.get("player_selector")?.value.map(player => player.uuid);
        //if(playersUUID?.length==0)player.tell("目标选择器未选中任何玩家也会进入这个分支")
    }
    if(result.params.get("player_name")?.value){
        const playerUUID=name2uuid(result.params.get("player_name")?.value)
        if(!playerUUID){
            player.tell("服务器中似乎不存在这个玩家，至少他近期从未在服务器中出现过。请先让该玩家上线一次再试。")
            return [];
        }
        playersUUID=[playerUUID]
        if(!playersUUID[0])throw new Error("无法选中玩家！")
    }
    if(playersUUID===undefined)throw new Error("由于未知原因，命令没有选中任何玩家！")
    return playersUUID
}

function dateTOCHS(date:Date){
    return date.getFullYear()+"年"+(date.getMonth()+1)+"月"+date.getDate()+"日"+date.getHours()+":"+date.getMinutes()+":"+date.getSeconds()
}