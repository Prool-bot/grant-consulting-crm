'use strict';
// Імітація лише використаних методів SpreadsheetApp; жодної мережі чи Google ID.
class FakeSheets {
  constructor() { this.reads=0;this.sheets=new Map();this.calls=0;this.failAt=0;this.after=false;this.held=false;this.resetMetrics(); }
  resetMetrics() {this.metrics={lookups:0,lastRows:0,maxRows:0,rangeReads:0,rangeWrites:0,writtenRows:0,projectionRows:0,flushes:0};this.ranges=[];}
  write(change) {
    this.calls++;
    if(this.calls===this.failAt&&!this.after)throw Error('Імітація квоти/обриву');
    change();
    if(this.calls===this.failAt&&this.after)throw Error('Імітація втраченої відповіді');
  }
  arm(at,after=false) {this.calls=0;this.failAt=at;this.after=after;}
  getSheetByName(name) {this.metrics.lookups++;return this.sheets.get(name)||null;}
  insertSheet(name) {let sheet;this.write(()=>{sheet=new FakeSheet(this,name);this.sheets.set(name,sheet);});return sheet;}
  flush() {this.metrics.flushes++;this.write(()=>{});}
  lock() {return {tryLock:()=>{if(this.held)return false;this.held=true;return true;},releaseLock:()=>{this.held=false;}};}
}
class FakeSheet {
  constructor(book,name) {this.book=book;this.name=name;this.rows=[];this.maxRows=1000;}
  getMaxRows() {this.book.metrics.maxRows++;return this.maxRows;}
  insertRowsAfter(index,count) {this.book.write(()=>{this.maxRows+=count;});}
  lastRow() {for(let i=this.rows.length-1;i>=0;i--)if(this.rows[i]?.some(v=>v!==''&&v!=null))return i+1;return 0;}
  getLastRow() {this.book.metrics.lastRows++;return this.lastRow();}
  getDataRange() {
    let width=1;for(const row of this.rows)if(row)for(let i=0;i<row.length;i++)if(row[i]!==''&&row[i]!=null)width=Math.max(width,i+1);
    return this.getRange(1,1,Math.max(1,this.lastRow()),width);
  }
  getRange(row,column,height=1,width=1) {
    if(row+height-1>this.maxRows||row<1||column<1||height<1||width<1)throw Error('Некоректний діапазон');
    const get=()=>{this.book.reads++;this.book.metrics.rangeReads++;return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>this.rows[row-1+i]?.[column-1+j]??''));};
    const put=values=>this.book.write(()=>{
      this.book.metrics.rangeWrites++;this.book.metrics.writtenRows+=height;
      if(!this.name.startsWith('_'))this.book.metrics.projectionRows+=height;
      this.book.ranges.push({name:this.name,row,height,width});
      if(values.length!==height||values.some(r=>r.length!==width))throw Error('Розмір діапазону');
      for(let i=0;i<height;i++)for(let j=0;j<width;j++) {
        const value=values[i][j];
        if(typeof value==='string'&&(value.length>50000||value.startsWith('=')))throw Error('Формула або завелика комірка');
        (this.rows[row-1+i]??=[])[column-1+j]=value;
      }
    });
    return {getValues:get,getValue:()=>get()[0][0],setValues:put,setValue:v=>put([[v]]),clearContent:()=>put(Array.from({length:height},()=>Array(width).fill('')))};
  }
}
module.exports={FakeSheets};
