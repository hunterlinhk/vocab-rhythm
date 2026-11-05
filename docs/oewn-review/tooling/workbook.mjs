import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
if(!process.env.ARTIFACT_NODE_MODULES)throw Error('Set ARTIFACT_NODE_MODULES to the isolated artifact-tool node_modules directory.');
const resolver=createRequire(path.join(process.env.ARTIFACT_NODE_MODULES,'resolver.cjs'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(resolver.resolve('@oai/artifact-tool')).href);
const out=path.resolve(process.argv[2]);
const {datasets,source,validation}=JSON.parse(await fs.readFile(path.join(out,'canonical.json'),'utf8'));
const wb=Workbook.create();
const overview=wb.worksheets.add('总览');
const info=[['项目','内容'],['baseline main',validation.baseline_main],...Object.entries(validation.counts),['exact_headwords',2742],['priority 100',26],['priority 0',19002],...Object.entries(source),['NGSL','https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv; CC BY-SA 4.0'],['审核说明','AI_REVIEW_INSTRUCTIONS.md'],['边界','全部候选，不是已批准学习内容。26 pilot 原样锁定；不得自动更改 priority。'],['缺字段','空白是来源未提供／null；不得补造。'],['例句','只含现有导入包的首条可用 synset 例句，可能使用同义词。'],['大小写','it→IT、or→OR、who→WHO、TRUE→true、FALSE→false，未导入。']];
overview.getRangeByIndexes(0,0,info.length,2).values=info;
overview.showGridLines=false;overview.getRangeByIndexes(0,0,info.length,2).format={font:{name:'Arial',size:11},wrapText:true,verticalAlignment:'top',rowHeight:44};
overview.getRangeByIndexes(0,0,info.length,1).format.columnWidth=28;overview.getRangeByIndexes(0,1,info.length,1).format.columnWidth=110;
overview.getRange('A1:B1').format={fill:'#263D55',font:{name:'Arial',bold:true,color:'#FFFFFF',size:11},rowHeight:30};
const tabs=[['NGSL词头','ngsl_headwords'],['精确匹配senses','exact_senses'],['已审核pilot','reviewed_pilot'],['大小写词头','case_only_headwords'],['大小写候选','case_only_senses'],['未匹配词头','unmatched_headwords']];
function width(h){return h==='definition_en'?74:h==='source_example'?62:h==='explanation'?70:h.includes('sha256')?72:h.endsWith('ids')?56:h==='headword'||h==='normalized_word'||h==='oewn_headword'?14:h==='sense_id'||h==='source_entry_ref'||h==='proposed_primary_sense_id'?36:h==='import_file'?58:h==='ipa'?24:h==='review_rationale'||h==='uncertainty'?58:24;}
for(const [name,key]of tabs){
 const sheet=wb.worksheets.add(name),rows=datasets[key],headers=Object.keys(rows[0]);
 const matrix=[headers,...rows.map(r=>headers.map(h=>r[h]??null))];
 const used=sheet.getRangeByIndexes(0,0,matrix.length,headers.length);used.values=matrix;
 sheet.showGridLines=false;used.format.font={name:'Arial',size:11,color:'#172033'};used.format.wrapText=true;used.format.verticalAlignment='top';used.format.rowHeight=key==='ngsl_headwords'?72:112;
 headers.forEach((h,i)=>{sheet.getRangeByIndexes(0,i,matrix.length,1).format.columnWidth=width(h);if(typeof rows[0][h]==='number')sheet.getRangeByIndexes(1,i,rows.length,1).setNumberFormat(h==='ngsl_sfi'?'0.00':'0');});
 sheet.getRangeByIndexes(0,0,1,headers.length).format={fill:'#263D55',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:40,horizontalAlignment:'center'};
 sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(2);
 sheet.tables.add(used,true,'Data_'+key);
 if(key==='case_only_headwords')sheet.getRangeByIndexes(1,0,rows.length,headers.length).format.rowHeight=210;
 if(key==='ngsl_headwords')for(const h of ['ai_decision','proposed_primary_sense_id','review_rationale','uncertainty'])sheet.getRangeByIndexes(1,headers.indexOf(h),rows.length,1).format.fill='#FFF3CD';
 console.log('Populated '+name+': '+rows.length);
}
wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'精确匹配senses!A1:I3',include:'values',tableMaxRows:3,tableMaxCols:9,maxChars:1200})).ndjson);
await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(out,'OEWN_AI_Review_Full.xlsx'));
const previewdir=path.resolve(process.argv[3]);await fs.mkdir(previewdir,{recursive:true});
for(const [i,[name,range]]of [['总览','A1:B12'],['NGSL词头','A1:H4'],['精确匹配senses','A1:H4'],['已审核pilot','A1:H4'],['大小写词头','A1:G3'],['大小写候选','A1:H4'],['未匹配词头','A1:D4']].entries()){
 const image=await wb.render({sheetName:name,range,scale:1,format:'png'});await fs.writeFile(path.join(previewdir,`sheet-${i}.png`),new Uint8Array(await image.arrayBuffer()));console.log('Rendered '+name);
}
await fs.rm(path.join(out,'OEWN_AI_Review_Full.xlsx.inspect.ndjson'),{force:true});
console.log('Export complete');
